---
uid: spec-detail-provenance-rollup
parent: SP-2
status: done
depends_on:
  - SP-2_SL-1
priority: P2
verified_req_hash: 26e600c5bd1cad7d90a78a91f21e059f18ab0b8a
---

# Commit/PR roll-up in the spec detail

`SpecsProvider` surfaces, per done slice, its recorded commit/PR as a
"delivered by" roll-up under the spec, so a finished Spec shows which
commits/PRs delivered each slice.
