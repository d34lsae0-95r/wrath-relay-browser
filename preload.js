const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("wrath", {
  health: async () => (await fetch("http://127.0.0.1:18972/health").then((r) => r.json()).catch(() => ({ relay: false }))),
  toggle: async (on) => (await fetch("http://127.0.0.1:18972/relay/toggle", { method: "POST", body: JSON.stringify({ on }) }).then((r) => r.json()).catch(() => ({ relay: false }))),
  pickUA: () => ipcRenderer.invoke("pick-ua"),
  shieldCount: () => ipcRenderer.invoke("shield-count"),
  setGeo: (m) => ipcRenderer.invoke("set-geo", m),
  getGeo: () => ipcRenderer.invoke("get-geo"),
  torRescan: () => ipcRenderer.invoke("tor-rescan"),
  onTor: (cb) => ipcRenderer.on("tor", (_, v) => cb(v)),
  onShield: (cb) => ipcRenderer.on("shield", (_, n) => cb(n)),
});
