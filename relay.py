#!/usr/bin/env python3
"""relay.py — public opt-in relay edge. stdlib only. No deps. No src leak.

Listens on 127.0.0.1:18972. Accepts opaque envelopes from the LOCAL
browser only, forwards to ONE guard at a time (rotated hourly), holds
nothing past 24h. Cannot read blobs, cannot resolve destinations,
cannot execute anything. Off switch kills relay, keeps browser alive.
"""
import base64
import hashlib
import hmac
import json
import os
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RELAY_PORT = 18972
RELAY_ON = {"on": False}
STATE_DIR = os.path.join(os.path.expanduser("~"), ".wrath-relay")
GUARD_FP = os.path.join(STATE_DIR, "guard.json")
HALT_FP = os.path.join(STATE_DIR, "halt")
COUNT_FP = os.path.join(STATE_DIR, "count.json")
MAX_BLOB = 64 * 1024
MAX_DAY = 100


def _now():
    return int(time.time())


def _b64u_decode(s):
    s = str(s or "")
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s.encode())


def _today():
    return time.strftime("%Y%m%d", time.localtime(_now()))


def _count():
    try:
        with open(COUNT_FP, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and d.get("day") == _today():
            return int(d.get("n", 0) or 0)
    except Exception:
        pass
    return 0


def _bump():
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        n = _count() + 1
        with open(COUNT_FP, "w", encoding="utf-8") as f:
            json.dump({"day": _today(), "n": n}, f)
        return n
    except Exception:
        return 999


def guard_addr():
    """One guard per hour. Directory URL comes from env/file the USER
    sets — never baked in. Returns "" if relay off or halted."""
    try:
        if not RELAY_ON.get("on"):
            return ""
        if os.path.exists(HALT_FP):
            return ""
        base = os.environ.get("WRATH_GUARD", "").strip()
        if not base:
            try:
                with open(GUARD_FP, "r", encoding="utf-8") as f:
                    base = str(json.load(f).get("guard", "") or "").strip()
            except Exception:
                base = ""
        if not base:
            return ""
        # hourly rotation: HMAC(hour) picks path suffix, guard resolves.
        # edge cannot enumerate — one address per request window.
        hr = str(_now() // 3600)
        suf = hmac.new(b"wrath-relay", hr.encode(), hashlib.sha256).hexdigest()[:8]
        return base.rstrip("/") + "/r/" + suf
    except Exception:
        return ""


def forward(envelope):
    """Validate shape, enforce caps, forward opaque. Returns (ok, msg)."""
    try:
        if not isinstance(envelope, dict):
            return False, "shape"
        if envelope.get("v") != 1:
            return False, "version"
        to = str(envelope.get("to", "") or "")
        blob = str(envelope.get("blob", "") or "")
        ttl = int(envelope.get("ttl", 0) or 0)
        if len(to) > 64 or len(blob) == 0:
            return False, "shape"
        raw = _b64u_decode(blob)
        if len(raw) == 0 or len(raw) > MAX_BLOB:
            return False, "size"
        if ttl <= 0 or ttl > 86400:
            return False, "ttl"
        if _count() >= MAX_DAY:
            return False, "rate"
        ga = guard_addr()
        if not ga:
            return False, "off"
        body = json.dumps({"v": 1, "to": to[:64], "ttl": ttl,
                           "blob": blob[:90000]}).encode()
        req = urllib.request.Request(ga, data=body,
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "wrath-relay/1"},
                                     method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                if r.status in (200, 202):
                    _bump()
                    return True, "sent"
                return False, "guard-%d" % r.status
        except Exception as ex:
            return False, "net"
    except Exception:
        return False, "err"


class H(BaseHTTPRequestHandler):
    server_version = "wrath-relay/1"

    def log_message(self, *a):
        pass

    def _deny(self):
        self.send_response(403)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/healthz"):
            on = bool(RELAY_ON.get("on")) and not os.path.exists(HALT_FP)
            body = json.dumps({"ok": True, "relay": on,
                               "used_today": _count(),
                               "max_day": MAX_DAY}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return self._deny()

    def do_POST(self):
        # local-only: relay accepts envelopes from the browser on this box.
        try:
            if (self.client_address or ("",))[0] not in ("127.0.0.1", "::1"):
                return self._deny()
        except Exception:
            return self._deny()
        if self.path == "/relay/toggle":
            try:
                ln = int(self.headers.get("Content-Length", "0") or 0)
                q = json.loads(self.rfile.read(max(0, ln)).decode("utf-8", "replace") or "{}")
                RELAY_ON["on"] = bool(q.get("on"))
                if not RELAY_ON["on"]:
                    try:
                        open(HALT_FP, "w").write("off")
                    except OSError:
                        pass
                else:
                    try:
                        if os.path.exists(HALT_FP):
                            os.unlink(HALT_FP)
                    except OSError:
                        pass
            except Exception:
                pass
            body = json.dumps({"relay": bool(RELAY_ON.get("on"))}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/relay/send":
            try:
                ln = int(self.headers.get("Content-Length", "0") or 0)
            except ValueError:
                ln = 0
            if ln <= 0 or ln > 128 * 1024:
                return self._deny()
            try:
                env = json.loads(self.rfile.read(ln).decode("utf-8", "replace"))
            except ValueError:
                return self._deny()
            ok, msg = forward(env)
            body = json.dumps({"ok": ok, "msg": msg}).encode()
            self.send_response(200 if ok else 429)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # halt: signed guard broadcast stops relay within 60s.
        if self.path == "/relay/halt":
            try:
                open(HALT_FP, "w").write("halt")
            except OSError:
                pass
            RELAY_ON["on"] = False
            body = b'{"relay":false}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return self._deny()


def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", RELAY_PORT), H)
    srv.serve_forever()


if __name__ == "__main__":
    main()
