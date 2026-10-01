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
function meshAppend(kind, obj) {
  try {
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
      return send(200, { ok: true, panel: "fallback", drops });
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
      // gossip sync: peers pull our mesh lines (unsigned local cache —
      // guards re-sign on merge; this node never forges authority)
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
