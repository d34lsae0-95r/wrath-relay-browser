// panel.js — fallback VPS on the user's box. The ENTIRE thing runs here:
// opaque drop cache (24h), mesh gossip sync with guards, guard directory,
// health + halt broadcast. No panel UI, no forge, no keys — store-forward
// + directory only. When the real VPS dies, the mesh re-homes through nodes
// like this one. stdlib-style, no deps.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = 18973;
const DIR = path.join(os.homedir(), ".wrath-panel");
const DROP = path.join(DIR, "drop");
const MESH = path.join(DIR, "mesh.jsonl");
try { fs.mkdirSync(DROP, { recursive: true }); } catch (e) {}
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

function sweep() {
  try {
    const cut = Date.now() - 86400 * 1000;
    for (const n of fs.readdirSync(DROP)) {
      if (!n.endsWith(".json")) continue;
      const fp = path.join(DROP, n);
      try { if (fs.statSync(fp).mtimeMs < cut) fs.unlinkSync(fp); } catch (e) {}
    }
  } catch (e) {}
}
function onionAddr() {
  try {
    const h = fs.readFileSync(path.join(os.homedir(), ".wrath-onion", "hostname"), "utf8").trim().slice(0, 128);
    if (/^[a-z2-7]{56}\.onion$/.test(h)) return h;
  } catch (e) {}
  return "";
}
function announce() {
  // publish our .onion to the guard so the mesh can re-home through us.
  // strict shape server-side, hourly rate limit. never blocks anything.
  try {
    const onion = onionAddr();
    if (!onion) return;
    let base = (process.env.WRATH_GUARD || "").trim();
    if (!base) {
      try { base = String(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".wrath-relay", "guard.json"), "utf8")).guard || "").trim(); } catch (e) {}
    }
    if (!base) base = "http://63.250.44.213:8080"; // bootstrap guard, overridable
    if (!base) return;
    const body = Buffer.from(JSON.stringify({ onion }));
    const u = new URL(base.replace(/\/$/, "") + "/api/mesh/announce");
    const lib = u.protocol === "https:" ? require("https") : http;
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length }, timeout: 15000 },
      (res) => { res.resume(); });
    req.on("error", () => {});
    req.on("timeout", () => { try { req.destroy(); } catch (e) {} });
    req.end(body);
  } catch (e) {}
}
function meshAppend(kind, obj) {  try {
    let seq = 0;
    try { for (const _ of fs.readFileSync(MESH, "utf8").split("\n")) if (_.trim()) seq++; } catch (e) {}
    const ev = { seq: seq + 1, t: Math.floor(Date.now() / 1000), kind: String(kind || "").slice(0, 32), obj: obj || {} };
    fs.appendFileSync(MESH, JSON.stringify(ev).slice(0, 4096) + "\n");
    return seq + 1;
  } catch (e) { return 0; }
}
function start() {
  sweep();
  setInterval(sweep, 600000);
  setTimeout(announce, 120000); // after Tor builds the HS descriptor
  setInterval(announce, 3600000);
  const srv = http.createServer((req, res) => {
    const send = (code, obj) => {
      const b = Buffer.from(JSON.stringify(obj));
      res.writeHead(code, { "Content-Type": "application/json", "Content-Length": b.length });
      res.end(b);
    };
    const u = new URL(req.url || "/", "http://x");
    if (req.method === "GET" && u.pathname === "/health") {
      let drops = 0;
      try { drops = fs.readdirSync(DROP).filter((x) => x.endsWith(".json")).length; } catch (e) {}
      return send(200, { ok: true, panel: "fallback", drops, onion: onionAddr() || null });
    }
    if (req.method === "POST" && u.pathname.startsWith("/r/")) {
      let body = Buffer.alloc(0);
      req.on("data", (c) => { body = Buffer.concat([body, c]); if (body.length > 131072) req.destroy(); });
      req.on("end", () => {
        try {
          const env = JSON.parse(body.toString());
          if (!env || env.v !== 1 || !env.to || !env.blob) return send(403, { ok: false });
          const raw = Buffer.from(String(env.blob), "base64url");
          if (!raw.length || raw.length > 65536) return send(403, { ok: false });
          const fn = crypto.randomBytes(8).toString("hex") + ".json";
          fs.writeFileSync(path.join(DROP, fn), JSON.stringify({ to: String(env.to).slice(0, 64), ttl: 86400, blob: String(env.blob).slice(0, 90000), at: Math.floor(Date.now() / 1000) }));
          meshAppend("drop", { id: fn });
          sweep();
          return send(202, { ok: true });
        } catch (e) { return send(403, { ok: false }); }
      });
      return;
    }
    if (req.method === "GET" && u.pathname === "/api/mesh/pull") {
      // gossip sync: peers pull our mesh lines. Unsigned local cache —
      // guards re-sign on merge via /api/mesh/merge; this node never
      // forges authority, only holds what it saw.
      try {
        const since = parseInt(u.searchParams.get("since") || "0", 10) || 0;
        const lines = fs.readFileSync(MESH, "utf8").split("\n").filter(Boolean);
        const out = [];
        for (const ln of lines) {
          try { const ev = JSON.parse(ln); if ((ev.seq | 0) > since) out.push(ev); } catch (e) {}
          if (out.length >= 500) break;
        }
        return send(200, { ok: true, evs: out, fallback: true });
      } catch (e) { return send(200, { ok: true, evs: [], fallback: true }); }
    }
    res.writeHead(403); res.end();
  });
  srv.listen(PORT, "127.0.0.1", () => console.log("fallback panel on 127.0.0.1:" + PORT));
}
module.exports = { start };
if (require.main === module) start();
