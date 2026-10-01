// main.js — WrathRelay v1.1. Brave-killer shell: ad/track block, geo+UA spoof,
// Tor SOCKS w/ live status, per-tab UA, shield counter, frameless dark chrome.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
require("./relay.js");

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
];
let win;
let shieldBlocked = 0;
function pickUA() { return UAS[Math.floor(Math.random() * UAS.length)]; }

// tracker/ad blocklists (substr match, fast, no deps)
const BLOCK = ["doubleclick.net", "googlesyndication.com", "google-analytics.com",
  "googletagmanager.com", "facebook.net/tr", "hotjar.com", "fullstory.com",
  "segment.io", "mixpanel.com", "criteo.com", "outbrain.com", "taboola.com",
  "scorecardresearch.com", "quantserve.com", "adsrvr.org", "adnxs.com"];

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
      if (torOn) await session.defaultSession.setProxy({ proxyRules: "socks5://127.0.0.1:9050", proxyBypassRules: "localhost,127.0.0.1" });
      else await session.defaultSession.setProxy({ mode: "direct" });
    } catch (e) {}
    try { win && win.webContents.send("tor", torOn); } catch (e) {}
  };
  // shield: block trackers/ads before they load
  try {
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
      try {
        const u = (d.url || "").toLowerCase();
        for (const b of BLOCK) {
          if (u.includes(b)) { shieldBlocked++; try { win && win.webContents.send("shield", shieldBlocked); } catch (e) {} return cb({ cancel: true }); }
        }
      } catch (e) {}
      cb({});
    });
  } catch (e) {}
  // geo spoof: override geolocation to user-selected city (default off = real)
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
      if (perm === "geolocation") {
        if (geoMode !== "off" && GEOS[geoMode]) {
          try { wc.send("geo-spoof", GEOS[geoMode]); } catch (e) {}
          return cb(true);
        }
        return cb(false); // deny real location always — spoof or nothing
      }
      cb(false);
    });
  } catch (e) {}
  ipcMain.handle("set-geo", (_, m) => { geoMode = GEOS[m] !== undefined ? m : "off"; return geoMode; });
  ipcMain.handle("get-geo", () => geoMode);
  ipcMain.handle("tor-rescan", async () => { torProbe(setTor); return true; });

  torProbe(setTor);
  setInterval(() => torProbe(setTor), 30000);

  win = new BrowserWindow({
    width: 1340, height: 860, backgroundColor: "#0a0a0d", title: "Wrath",
    autoHideMenuBar: true, icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), webviewTag: true },
  });
  win.setTitle("Wrath");
  win.loadFile("ui.html");
  app.on("web-contents-created", (_, c) => {
    try { c.setUserAgent(pickUA()); } catch (e) {}
  });
}
app.whenReady().then(boot);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
ipcMain.handle("pick-ua", () => pickUA());
ipcMain.handle("shield-count", () => shieldBlocked);
