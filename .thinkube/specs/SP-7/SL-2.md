---
uid: mint-base36-epoch-ids-for-new-specs
parent: SP-7
status: done
depends_on:
  - SP-7_SL-1
satisfies:
  - 1
  - 2
  - 3
verified_req_hash: 99f16fa9ff7616588e277f066503b2d49229c4c8
commit: 7b34fd47d60849daa67d63712036bbc26dc5e3d2
---
# Mint base36-epoch ids for new Specs

nextSpecNumber mints a zero-padded base36 encoding of floor(Date.now()/1000), monotonic per writer (track the last-minted second in-process; bump +1s on a same-second repeat); delete SP-5's SL-3 canonical-repo round-trip in onCreateSpec (boards.ts) — epoch ids don't collide, so the WorktreeService.canonicalRepo dance goes.
Done: creating a Spec yields `SP-<base36>` (sortable, decodable to a time); two independent creations get distinct ids with no canonical round-trip. (Satisfies AC #1, #2, #3.)
