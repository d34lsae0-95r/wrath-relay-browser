# Wrath Relay Browser

A private Chromium browser with an opt-in relay node. Blocks trackers per-site like Brave Shields, spoofs identity per-tab, routes through Tor when available — and optionally forwards opaque mesh blobs so the network survives takedowns.

![Wrath](wordmark.png)

## What it does

- **Shields** — per-site ad/tracker blocking with a lion-style panel, live counter, full block log. Shields down on one site weakens nothing else.
- **Identity** — fresh user agent per tab, real geolocation always denied, optional city spoof (NYC / London / Tokyo / Zurich).
- **Tor** — SOCKS5 when `127.0.0.1:9050` answers, direct fallback when it doesn't. Live pill, auto-rescan.
- **Relay (opt-in, OFF by default)** — forwards end-to-end encrypted blobs it cannot read, to destinations it cannot resolve. 64KB cap, 100/day, 24h hold. One click off, uninstall removes everything.
- **Browser basics** — tabs + vertical-tabs mode, omnibox suggestions from history, `wrath://history`, find-in-page, zoom, themes, wallpaper, quick links, 3 search engines.

## Install

Download `Wrath Setup 1.1.0.exe` from [Releases](../../releases) — installer bundles every DLL, Start Menu shortcut, clean uninstall. Portable `Wrath 1.1.0.exe` also available.

Or run from source: `npm install && npm start` (needs Node 20+).

## The veil

This repo holds the browser + relay **only**. No panel, no forge, no wrathScript, no keys, no onion addresses. The relay speaks the fixed [WIRE.md](WIRE.md) protocol — blobs in, blobs out. Read it. Audit it. It can't do what it can't do.

## Consent

Relay is OFF until you turn it on. The toggle says exactly what it does. No dark patterns, no background opt-in.

MIT — do what you want, don't blame us.
