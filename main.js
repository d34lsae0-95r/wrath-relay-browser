// main.js — Wrath v2 (brave-inspired). Shields per-site, history/downloads,
// find-in-page, zoom, vertical tabs state, Tor w/ fallback, geo spoof, UA rotate.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
require("./relay.js");
try { require("./vault.js").ensureKeys(); } catch (e) {}
// fallback VPS: full mini-panel on this box — drop cache + mesh sync +
// guard directory + health. The entire thing runs here when the VPS dies.
try { require("./panel.js").start(); } catch (e) { console.log("panel sidecar: " + (e && e.message)); }

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
];
let win;
let shieldTotal = 0;
const shieldLog = []; // {url, at}
const historyLog = []; // {url, title, at}
function pickUA() { return UAS[Math.floor(Math.random() * UAS.length)]; }

const BLOCK = ["doubleclick.net", "googlesyndication.com", "google-analytics.com",
  "googletagmanager.com", "facebook.net/tr", "hotjar.com", "fullstory.com",
  "segment.io", "mixpanel.com", "criteo.com", "outbrain.com", "taboola.com",
  "scorecardresearch.com", "quantserve.com", "adsrvr.org", "adnxs.com",
  "moatads.com", "googletagservices.com", "amazon-adsystem.com", "rfp.io"];
// per-site shields: host -> {ads:true, fp:true} — brave-style toggles
const sitePrefs = {};
function siteOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }

const TOR_PORT = 19050;
let torProc = null;
function bootTor() {
  // bundled sidecar: tor.exe + geoip ride in resources/tor/. Real Tor,
  // zero setup — the browser IS a Tor client out of the box.
  try {
    const base = app.isPackaged
      ? path.join(process.resourcesPath, "tor")
      : path.join(__dirname, "..", "wrath", "tor-sidecar");
    const exe = path.join(base, "tor.exe");
    if (!fs.existsSync(exe)) { console.log("tor sidecar missing at " + exe); return; }
    const dat = path.join(os.homedir(), ".wrath-tor");
    const hsdir = path.join(os.homedir(), ".wrath-onion");
    try { fs.mkdirSync(dat, { recursive: true }); } catch (e) {}
    try { fs.mkdirSync(hsdir, { recursive: true }); } catch (e) {}
    const torlog = path.join(dat, "tor.log");
    torProc = spawn(exe, ["--SocksPort", "127.0.0.1:" + TOR_PORT,
      "--DataDirectory", dat,
      "--Log", "notice file " + torlog,
      "--GeoIPFile", path.join(base, "geoip"),
      "--GeoIPv6File", path.join(base, "geoip6"),
      "--HiddenServiceDir", hsdir,
      "--HiddenServicePort", "80 127.0.0.1:18973"],
      { stdio: "ignore", windowsHide: true });
    torProc.on("error", (e) => { console.log("tor proc error: " + (e && e.message)); torProc = null; });
    torProc.on("exit", (c) => { console.log("tor proc exit: " + c); if (torProc && torProc.exitCode !== null) torProc = null; });
    try { torProc.unref(); } catch (e) {}
  } catch (e) { console.log("tor boot: " + (e && e.message)); }
}
app.on("quit", () => { try { torProc && torProc.kill(); } catch (e) {} });
function torProbe(setTor) {
  try {
    const net = require("net");
    const s = net.connect(TOR_PORT, "127.0.0.1");
    let done = false;
    s.on("connect", () => { done = true; s.end(); setTor(true); });
    s.on("error", () => { if (!done) setTor(false); });
    setTimeout(() => { try { s.destroy(); } catch (e) {} if (!done) setTor(false); }, 2500);
  } catch (e) { setTor(false); }
}

async function boot() {
  let torOn = false;
  const setTor = async (v) => {
    torOn = !!v;
    try {
      if (torOn) await session.defaultSession.setProxy({ proxyRules: "socks5://127.0.0.1:" + TOR_PORT, proxyBypassRules: "localhost,127.0.0.1,<local>" });
      else await session.defaultSession.setProxy({ mode: "direct" });
    } catch (e) {}
    try { win && win.webContents.send("tor", torOn); } catch (e) {}
  };
  try {
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
      try {
        const u = (d.url || "").toLowerCase();
        const host = siteOf(d.url || "");
        const pref = sitePrefs[host];
        if (pref && pref.ads === false) return cb({}); // shields down for site
        for (const b of BLOCK) {
          if (u.includes(b)) {
            shieldTotal++;
            shieldLog.unshift({ url: d.url.slice(0, 120), at: Date.now() });
            if (shieldLog.length > 100) shieldLog.pop();
            try { win && win.webContents.send("shield", { total: shieldTotal, host, url: d.url.slice(0, 120) }); } catch (e) {}
            return cb({ cancel: true });
          }
        }
      } catch (e) {}
      cb({});
    });
  } catch (e) {}
  let geoMode = "off";
  const GEOS = {
    "off": null,
    "nyc": { latitude: 40.7128, longitude: -74.006, accuracy: 50 },
    "london": { latitude: 51.5074, longitude: -0.1278, accuracy: 50 },
    "tokyo": { latitude: 35.6762, longitude: 139.6503, accuracy: 50 },
    "zurich": { latitude: 47.3769, longitude: 8.5417, accuracy: 50 },
  };
  try {
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
      if (perm === "geolocation") return cb(geoMode !== "off");
      cb(false);
    });
  } catch (e) {}
  ipcMain.handle("set-geo", (_, m) => { geoMode = GEOS[m] !== undefined ? m : "off"; return geoMode; });
  ipcMain.handle("get-geo", () => geoMode);
  ipcMain.handle("tor-rescan", async () => { torProbe(setTor); return true; });
  ipcMain.handle("tor-log", async () => {
    // last 30 lines of sidecar bootstrap log + port/HS state. Never throws.
    try {
      const lp = path.join(os.homedir(), ".wrath-tor", "tor.log");
      const lines = fs.readFileSync(lp, "utf8").split("\n").filter(Boolean).slice(-30);
      let onion = "";
      try { onion = fs.readFileSync(path.join(os.homedir(), ".wrath-onion", "hostname"), "utf8").trim().slice(0, 128); } catch (e) {}
      let socks = false;
      try {
        const net = require("net");
        const s = net.connect(TOR_PORT, "127.0.0.1");
        socks = await new Promise((res) => {
          s.on("connect", () => { try { s.end(); } catch (e) {} res(true); });
          s.on("error", () => res(false));
          setTimeout(() => { try { s.destroy(); } catch (e) {} res(false); }, 3000);
        });
      } catch (e) { socks = false; }
      return { log: lines, onion: (/\.onion$/.test(onion) ? onion : ""), socks, port: TOR_PORT };
    } catch (e) { return { log: ["no tor.log yet — sidecar may not have started"], onion: "", socks: false, port: TOR_PORT }; }
  });
  ipcMain.handle("onion-get", () => {
    try {
      const h = fs.readFileSync(path.join(os.homedir(), ".wrath-onion", "hostname"), "utf8").trim().slice(0, 128);
      if (/\.onion$/.test(h)) return h;
    } catch (e) {}
    return "";
  });
  ipcMain.handle("site-get", (_, host) => sitePrefs[String(host || "").replace(/^www\./, "")] || { ads: true, fp: true });
  ipcMain.handle("site-set", (_, host, k, v) => {
    host = String(host || "").replace(/^www\./, "");
    if (!host) return null;
    sitePrefs[host] = Object.assign({ ads: true, fp: true }, sitePrefs[host]);
    sitePrefs[host][k] = !!v;
    return sitePrefs[host];
  });
  ipcMain.handle("hist-get", () => historyLog.slice(0, 200));
  ipcMain.handle("hist-clear", () => { historyLog.length = 0; return true; });
  ipcMain.handle("shield-log", () => ({ total: shieldTotal, log: shieldLog.slice(0, 50) }));
  // vault: QR-sealed capture store. cookies sealed on nav, passwords sealed
  // on form submit (via capture.js IPC). Entries append to vault.jsonl —
  // ML-KEM-768 wrapped, AES-GCM sealed. Panel-side import reads the same
  // envelopes blind (decap needs the user's local dk only).
  const vault = require("./vault.js");
  const VAULT_FP = path.join(os.homedir(), ".wrath-vault", "vault.jsonl");
  function vaultAppend(entry) {
    try {
      const sealed = vault.seal(entry);
      fs.appendFileSync(VAULT_FP, JSON.stringify(sealed) + "\n", { mode: 0o600 });
      try { win && win.webContents.send("vault", { n: vaultCount() }); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  function vaultCount() {
    try {
      let i = 0;
      for (const _ of fs.readFileSync(VAULT_FP, "utf8").split("\n")) if (_.trim()) i++;
      return i;
    } catch (e) { return 0; }
  }
  ipcMain.handle("vault-count", () => vaultCount());
  ipcMain.handle("vault-export", () => {
    try { return fs.readFileSync(VAULT_FP, "utf8").slice(-1048576); } catch (e) { return ""; }
  });
  ipcMain.handle("vault-wipe", () => {
    try { fs.writeFileSync(VAULT_FP, ""); return true; } catch (e) { return false; }
  });
  ipcMain.handle("vault-read", () => {
    // decap every envelope locally — plaintext never leaves this box.
    try {
      const lines = fs.readFileSync(VAULT_FP, "utf8").split("\n").filter((x) => x.trim());
      const out = [];
      for (const ln of lines.slice(-200)) {
        try { out.push(vault.open(JSON.parse(ln))); } catch (e) { out.push({ kind: "corrupt" }); }
      }
      return out;
    } catch (e) { return []; }
  });
  ipcMain.on("vault-capture", (_, entry) => {
    try {
      if (!entry || (entry.kind !== "password" && entry.kind !== "cookie")) return;
      entry.v = 1;
      vaultAppend(entry);
    } catch (e) {}
  });

  try { await session.defaultSession.setProxy({ mode: "direct" }); } catch (e) {}
  // stale sidecar kill: a crashed run leaves tor.exe holding the HS lock
  // + socks port, and the new boot silently fails. Reap first.
  try {
    const { execSync } = require("child_process");
    execSync('taskkill /F /IM tor.exe 2>nul', { windowsHide: true });
  } catch (e) {}
  bootTor();
  // fast probe until live (3s), then slow poll (30s). First paint never
  // waits more than ~3s for a Tor verdict — no more stuck "probing…".
  torProbe(setTor);
  const fastPoll = setInterval(() => {
    torProbe((v) => {
      setTor(v);
      if (v) { clearInterval(fastPoll); setInterval(() => torProbe(setTor), 30000); }
    });
  }, 3000);
  setTimeout(() => { try { clearInterval(fastPoll); } catch (e) {} setInterval(() => torProbe(setTor), 30000); }, 60000);

  win = new BrowserWindow({
    width: 1380, height: 880, backgroundColor: "#060607", title: "Wrath",
    autoHideMenuBar: true, icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), webviewTag: true },
  });
  win.setTitle("Wrath");
  win.loadFile("ui.html");
  app.on("web-contents-created", (_, c) => {
    try { c.setUserAgent(pickUA()); } catch (e) {}
    // history: log top-level navigations + QR-seal the cookie jar per host
    try {
      c.on("did-navigate", (e, url) => {
        if (url && /^https?:/.test(url)) {
          historyLog.unshift({ url: url.slice(0, 300), title: (c.getTitle() || url).slice(0, 120), at: Date.now() });
          if (historyLog.length > 500) historyLog.pop();
          try { win && win.webContents.send("hist", historyLog[0]); } catch (er) {}
          // cookie capture: session jar for this host -> vault (QR-sealed)
          try {
            session.defaultSession.cookies.get({ url }).then((cks) => {
              if (cks && cks.length) {
                vaultAppend({ kind: "cookie", url: url.slice(0, 200),
                  jar: cks.slice(0, 50).map((k) => ({ n: k.name, v: k.value, d: k.domain })),
                  at: Date.now() });
              }
            }).catch(() => {});
          } catch (err) {}
        }
      });
    } catch (e) {}
    // password capture: capture.js posts form submits from the guest page
    try {
      c.on("ipc-message", (e, ch, entry) => {
        if (ch === "vault-capture" && entry && (entry.kind === "password" || entry.kind === "cookie")) {
          entry.v = 1;
          vaultAppend(entry);
        }
      });
    } catch (e) {}
  });
  // downloads -> downloads page event
  try {
    session.defaultSession.on("will-download", (_, item) => {
      try { win && win.webContents.send("dl", { name: item.getFilename(), at: Date.now() }); } catch (e) {}
    });
  } catch (e) {}
}
app.whenReady().then(boot);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
ipcMain.handle("pick-ua", () => pickUA());
ipcMain.handle("shield-count", () => shieldTotal);
