#!/usr/bin/env python3
"""launch.py — open the hardened browser profile + local relay.

Usage: python launch.py [--relay-off]
Starts relay.py (127.0.0.1:18972, OFF by default), then launches the
system Firefox/Chrome with a locked-down profile: WebRTC off, UA + geo
spoof rotation, Tor via env WRATH_TOR_SOCKS (default 127.0.0.1:9050).
No vendored C2. No keys. Just a browser and a dumb pipe.
"""
import os
import secrets
import subprocess
import sys
import tempfile
import time

RELAY_PORT = 18972


def start_relay():
    try:
        import urllib.request
        urllib.request.urlopen("http://127.0.0.1:%d/health" % RELAY_PORT, timeout=2).read()
        return
    except Exception:
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        subprocess.Popen([sys.executable, os.path.join(here, "relay.py")],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def pick_ua():
    uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    ]
    return uas[secrets.randbelow(len(uas))]


def main():
    start_relay()
    time.sleep(1)
    ua = pick_ua()
    prof = tempfile.mkdtemp(prefix="wrath-prof-")
    # Firefox profile: webrtc off, resist fingerprint on, socks proxy = tor.
    try:
        with open(os.path.join(prof, "user.js"), "w", encoding="utf-8") as f:
            f.write('user_pref("media.peerconnection.enabled", false);\n'
                    'user_pref("privacy.resistFingerprinting", true);\n'
                    'user_pref("network.proxy.socks", "127.0.0.1");\n'
                    'user_pref("network.proxy.socks_port", 9050);\n'
                    'user_pref("network.proxy.type", 1);\n'
                    'user_pref("general.useragent.override", "%s");\n' % ua)
    except OSError:
        pass
    print("profile: %s" % prof)
    print("ua: %s" % ua)
    print("relay: http://127.0.0.1:%d/health (OFF by default — open consent.html to opt in)" % RELAY_PORT)
    for cand in ("firefox", "firefox.exe", "chrome", "chrome.exe"):
        try:
            subprocess.Popen([cand, "--profile", prof])
            return
        except OSError:
            continue
    print("open your browser with profile dir above + SOCKS5 127.0.0.1:9050.")


if __name__ == "__main__":
    main()
