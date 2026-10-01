# Wrath Relay Browser — open-source privacy browser + opt-in relay node.
#
# What it IS: a hardened browser (Tor built in, UA + geo spoof rotation,
# fingerprint kill) with an OPTIONAL relay that helps the mesh survive.
# What it is NOT: it never touches your files, never runs tasks on your
# own machine, never persists past uninstall. The relay forwards OPAQUE
# blobs — encrypted chunks it cannot read, from senders it cannot name,
# to destinations it cannot see. Zero knowledge by construction.
#
# Consent: relay is OFF by default. First run shows a plain-words screen.
# Toggle off anytime, one click, no restart. Uninstall removes everything.
#
# Source veil: this repo holds the browser + relay ONLY. The C2 /
# panel / forge / brain live in a private repo and are never vendored
# here. The relay speaks a fixed wire protocol (see WIRE.md) — blobs in,
# blobs out. No panel URLs, no keys, no builder logic in this tree.

MIT License — do what you want, don't blame us.
