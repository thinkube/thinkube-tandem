---
uid: sp2-cards-normalized
parent: SP-4
status: done
depends_on:
  - SP-4_SL-1
parallel: true
priority: P2
verified_req_hash: 2db2bf6e1da1b39d4a3c63902ffefe45d9d7a0fe
---

# SP-2's three cards read correctly on the board

Normalize SP-2's merged-line slice files (SL-1..3) to the canonical
`# title` + detail shape using the new `update_slice` guard — dogfooding
the tool on the data that motivated it. Done = the board renders the three
SP-2 cards with short titles and detail bodies instead of clipped
paragraph-titles.
