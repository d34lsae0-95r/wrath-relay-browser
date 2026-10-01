# Wrath Relay Wire v1 (public)
#
# The relay is a dumb pipe. It never learns what it carries.
#
# Roles:
#   - EDGE: your browser node. stores nothing, reads nothing.
#   - GUARD: a VPS-run directory. hands edges opaque peer lists.
#   - DROP: any guard. accepts opaque envelopes, holds max 24h.
#
# Envelope (EDGE -> GUARD -> DROP):
#   {
#     "v": 1,
#     "to": "<base64url 32B blinded drop id — edge cannot resolve it>",
#     "ttl": 86400,
#     "blob": "<base64url, max 64KB, end-to-end encrypted by the SENDER>"
#   }
#
# Rules the edge enforces on ITSELF:
#   - blob is opaque bytes. edge never decrypts, never parses, never logs.
#   - `to` is a blinded id. edge never resolves it to an address.
#   - max 64KB per envelope, max 100/day per edge, max 24h hold.
#   - no task execution. no file access. no shell. relay only.
#   - guard addresses come from a signed directory the edge verifies
#     but cannot enumerate (one guard per request, rotated hourly).
#
# Abuse rails (public, auditable):
#   - rate limits above are hardcoded, not configured.
#   - edges accept412f2c envelopes only from local browser (127.0.0.1).
#   - kill switch: GUARD sends {"v":1,"halt":true} signed — edge stops
#     relaying within 60s, browser keeps working.
#
# What you will NOT find in this repo (by design):
#   panel source, forge, wrathScript, brain, keys, onion addresses,
#   victim schemas, task types. The edge doesn't know them. Neither do you.
