---
uid: slice-provenance-stamp-on-done
parent: SP-2
status: done
priority: P2
verified_req_hash: 26e600c5bd1cad7d90a78a91f21e059f18ab0b8a
---

# Provenance stamp when a slice enters Done

Best-effort capture of the branch HEAD commit and open PR, stamped via one
shared `stampOnEnteringDone` on both the MCP `move_slice` and panel
drag-to-Done seams — never blocking the move when `git`/`gh` are absent.
