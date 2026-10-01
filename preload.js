const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("wrath", {
  health: async () => (await fetch("http://127.0.0.1:18972/health").then((r) => r.json()).catch(() => ({ relay: false }))),
  toggle: async (on) => (await fetch("http://127.0.0.1:18972/relay/toggle", { method: "POST", body: JSON.stringify({ on }) }).then((r) => r.json()).catch(() => ({ relay: false }))),
  pickUA: () => ipcRenderer.invoke("pick-ua"),
});
