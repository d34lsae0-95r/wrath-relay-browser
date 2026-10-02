// relay.js — same dumb pipe as relay.py, node port. No deps.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const PORT = 18972;
const MAX_BLOB = 64 * 1024;
const MAX_DAY = 100;
let relayOn = false;

const DIR = path.join(os.homedir(), ".wrath-relay");
const HALT = path.join(DIR, "halt");
const COUNT = path.join(DIR, "count.json");
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

function today() { return new Date().toISOString().slice(0, 10).replace(/-/g, ""); }
function count() {
  try {
    const d = JSON.parse(fs.readFileSync(COUNT, "utf8"));
    if (d.day === today()) return d.n | 0;
  } catch (e) {}
  return 0;
}
function bump() {
  try { fs.writeFileSync(COUNT, JSON.stringify({ day: today(), n: count() + 1 })); } catch (e) {}
}
// Bootstrap guard: the fleet's guard onion goes here at release time.
// Overridable via WRATH_GUARD env or ~/.wrath-relay/guard.json, or the
// in-app Network settings row. Without any guard the relay holds (no
// silent direct leaks) — set one to join the mesh.
const DEFAULT_GUARD = "http://doef5xgdqcrdxxmvpodjtbt3h7xqkojygwyh2wsovk7rhzdqvdnsxcyd.onion";
function guardBase() {
  let base = (process.env.WRATH_GUARD || "").trim();
  if (!base) {
    try { base = String(JSON.parse(fs.readFileSync(path.join(DIR, "guard.json"), "utf8")).guard || "").trim(); } catch (e) {}
  }
  if (!base) base = DEFAULT_GUARD;
  return base;
}
function guardAddr() {
  if (!relayOn) return "";
  try { if (fs.existsSync(HALT)) return ""; } catch (e) {}
  const base = guardBase();
  if (!base) return "";
  // hourly rotation: HMAC(hour) picks path suffix, guard resolves.
  // edge cannot enumerate — one address per request window.
  const hr = String(Math.floor(Date.now() / 3600000));
  const suf = crypto.createHmac("sha256", "wrath-relay").update(hr).digest("hex").slice(0, 8);
  return base.replace(/\/$/, "") + "/r/" + suf;
}
function socksPost(url, body) {
  const bb = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8");
  return new Promise((resolve) => {
    try {
      const net = require("net");
      const u = new URL(url);
      const host = u.hostname;
      const port = parseInt(u.port || "80", 10) || 80;
      const s = net.connect(19050, "127.0.0.1");
      let done = false;
      const fail = () => { if (!done) { done = true; try { s.destroy(); } catch (e) {} resolve(0); } };
      s.setTimeout(20000, fail);
      s.on("error", fail);
      s.on("connect", () => {
        const hb = Buffer.from(host, "utf8");
        s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, Buffer.from([(port >> 8) & 255, port & 255])]));
        let buf = Buffer.alloc(0);
        const onData = (c) => {
          buf = Buffer.concat([buf, c]);
          if (buf.length < 10) return;
          if (buf[1] !== 0x00) { s.removeListener("data", onData); return fail(); }
          s.removeListener("data", onData);
          const path = (u.pathname || "/") + (u.search || "");
          s.write(Buffer.concat([Buffer.from("POST " + path + " HTTP/1.1\r\nHost: " + host + "\r\nContent-Type: application/json\r\nContent-Length: " + bb.length + "\r\nConnection: close\r\n\r\n"), bb]));
          let rb = Buffer.alloc(0);
          const finish = (code) => { if (!done) { done = true; try { s.destroy(); } catch (e) {} resolve(code); } };
          s.on("data", (d) => {
            rb = Buffer.concat([rb, d]);
            // resolve on response head — don't wait for close (Tor holds).
            try {
              const hs = rb.toString("utf8");
              if (hs.indexOf("\r\n\r\n") >= 0 || hs.indexOf("\n\n") >= 0) {
                finish(parseInt(((hs.split("\r\n")[0] || "").split(" ")[1] || "0"), 10) || 0);
              }
            } catch (e) {}
          });
          s.on("close", () => {
            if (done) return;
            try { finish(parseInt((rb.toString("utf8").split("\r\n")[0] || "").split(" ")[1] || "0", 10) || 0); }
            catch (e) { finish(0); }
          });
        };
        s.on("data", onData);
      });
    } catch (e) { resolve(0); }
  });
}
function post(url, body) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "wrath-relay/1" }, timeout: 15000 },
        (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", () => resolve(0));
      req.on("timeout", () => { req.destroy(); resolve(0); });
      req.end(body);
    } catch (e) { resolve(0); }
  });
}
const srv = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { "Content-Type": "application/json", "Content-Length": b.length });
    res.end(b);
  };
  if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
    let halted = false;
    try { halted = fs.existsSync(HALT); } catch (e) {}
    return send(200, { ok: true, relay: relayOn && !halted, used_today: count(), max_day: MAX_DAY, guard: guardBase() });
  }
  if (req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::1" && req.socket.remoteAddress !== "::ffff:127.0.0.1")
    { res.writeHead(403); return res.end(); }
  let body = Buffer.alloc(0);
  req.on("data", (c) => { body = Buffer.concat([body, c]); if (body.length > 131072) req.destroy(); });
  req.on("end", async () => {
    if (req.method === "POST" && req.url === "/relay/toggle") {
      try { relayOn = !!JSON.parse(body.toString() || "{}").on; } catch (e) {}
      try { if (!relayOn) fs.writeFileSync(HALT, "off"); else if (fs.existsSync(HALT)) fs.unlinkSync(HALT); } catch (e) {}
      return send(200, { relay: relayOn });
    }
    if (req.method === "POST" && req.url === "/relay/halt") {
      try { fs.writeFileSync(HALT, "halt"); } catch (e) {}
      relayOn = false;
      return send(200, { relay: false });
    }
    if (req.method === "GET" && req.url === "/relay/guard") {
      return send(200, { guard: guardBase() });
    }
    if (req.method === "POST" && req.url === "/relay/guard") {
      try {
        const q = JSON.parse(body.toString() || "{}");
        const g = String(q.guard || "").trim().slice(0, 200);
        if (!/^https?:\/\/[A-Za-z0-9.\-:]{4,120}$/.test(g) && !/^[a-z2-7]{56}\.onion$/.test(g.replace(/^https?:\/\//, "").split(":")[0])) {
          // onion guard without scheme gets http://
          if (/^[a-z2-7]{56}\.onion(:\d+)?$/.test(g)) {
            fs.writeFileSync(path.join(DIR, "guard.json"), JSON.stringify({ guard: "http://" + g }));
            return send(200, { guard: "http://" + g });
          }
          return send(429, { ok: false, msg: "shape" });
        }
        fs.writeFileSync(path.join(DIR, "guard.json"), JSON.stringify({ guard: g }));
        return send(200, { guard: g });
      } catch (e) { return send(429, { ok: false, msg: "err" }); }
    }
    if (req.method === "POST" && req.url === "/relay/send") {
      let env;
      try { env = JSON.parse(body.toString()); } catch (e) { return send(429, { ok: false, msg: "shape" }); }
      if (!env || env.v !== 1 || !env.to || !env.blob) return send(429, { ok: false, msg: "shape" });
      let raw;
      try { raw = Buffer.from(String(env.blob), "base64url"); } catch (e) { return send(429, { ok: false, msg: "shape" }); }
      if (!raw.length || raw.length > MAX_BLOB) return send(429, { ok: false, msg: "size" });
      if (count() >= MAX_DAY) return send(429, { ok: false, msg: "rate" });
      const ga = guardAddr();
      if (!ga) return send(429, { ok: false, msg: "off" });
      const st = /\.onion/i.test(ga)
        ? await socksPost(ga, JSON.stringify({ v: 1, to: String(env.to).slice(0, 64), ttl: 86400, blob: String(env.blob).slice(0, 90000) }))
        : await post(ga, JSON.stringify({ v: 1, to: String(env.to).slice(0, 64), ttl: 86400, blob: String(env.blob).slice(0, 90000) }));
      if (st === 200 || st === 202) { bump(); return send(200, { ok: true, msg: "sent" }); }
      return send(429, { ok: false, msg: "guard-" + st });
    }
    res.writeHead(403); res.end();
  });
});
srv.listen(PORT, "127.0.0.1", () => console.log("relay on 127.0.0.1:" + PORT));
module.exports = { setRelay: (v) => { relayOn = !!v; } };
