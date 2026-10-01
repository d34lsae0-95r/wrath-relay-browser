// main.js — WrathRelay shell. Dark Chromium, tabs, UA rotate, Tor SOCKS, relay toggle.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
require("./relay.js");

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];
let win;
function pickUA() { return UAS[Math.floor(Math.random() * UAS.length)]; }

async function boot() {
  // Tor SOCKS if present (127.0.0.1:9050), else direct. Never breaks browsing.
  try {
    await session.defaultSession.setProxy({ proxyRules: "socks5://127.0.0.1:9050", proxyBypassRules: "localhost,127.0.0.1" });
    // probe: if tor down, fall back to direct after 3s
    setTimeout(async () => {
      try {
        const net = require("net");
        const s = net.connect(9050, "127.0.0.1");
        s.on("connect", () => s.end());
        s.on("error", async () => { try { await session.defaultSession.setProxy({ mode: "direct" }); } catch (e) {} });
        setTimeout(() => { try { s.destroy(); } catch (e) {} }, 2000);
      } catch (e) {}
    }, 1000);
  } catch (e) {}
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: "#0a0a0d", title: "Wrath Relay",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), webviewTag: true },
  });
  win.loadFile("ui.html");
  // per-tab UA rotation: every new webview gets a fresh UA
  app.on("web-contents-created", (_, c) => {
    try { c.setUserAgent(pickUA()); } catch (e) {}
  });
}
app.whenReady().then(boot);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
ipcMain.handle("pick-ua", () => pickUA());
