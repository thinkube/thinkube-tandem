---
uid: slice-card-commit-pr-links
parent: SP-2
status: done
depends_on:
  - SP-2_SL-1
priority: P2
verified_req_hash: 26e600c5bd1cad7d90a78a91f21e059f18ab0b8a
---

Clickable commit/PR links on the slice card — thread the recorded `commit`/`pr` through the board projection and `TaskCard` (both type mirrors) so a done card renders them as external links (commit → remote host, PR → the pull request) via the Panel open-external bridge.
