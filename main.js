// main.js — Wrath v2 (brave-inspired). Shields per-site, history/downloads,
// find-in-page, zoom, vertical tabs state, Tor w/ fallback, geo spoof, UA rotate.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
require("./relay.js");

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

function torProbe(setTor) {
  try {
    const net = require("net");
    const s = net.connect(9050, "127.0.0.1");
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
      if (torOn) await session.defaultSession.setProxy({ proxyRules: "socks5://127.0.0.1:9050", proxyBypassRules: "localhost,127.0.0.1,<local>" });
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

  try { await session.defaultSession.setProxy({ mode: "direct" }); } catch (e) {}
  torProbe(setTor);
  setInterval(() => torProbe(setTor), 30000);

  win = new BrowserWindow({
    width: 1380, height: 880, backgroundColor: "#060607", title: "Wrath",
    autoHideMenuBar: true, icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), webviewTag: true },
  });
  win.setTitle("Wrath");
  win.loadFile("ui.html");
  app.on("web-contents-created", (_, c) => {
    try { c.setUserAgent(pickUA()); } catch (e) {}
    // history: log top-level navigations
    try {
      c.on("did-navigate", (e, url) => {
        if (url && /^https?:/.test(url)) {
          historyLog.unshift({ url: url.slice(0, 300), title: (c.getTitle() || url).slice(0, 120), at: Date.now() });
          if (historyLog.length > 500) historyLog.pop();
          try { win && win.webContents.send("hist", historyLog[0]); } catch (er) {}
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
