---
uid: contract-ships-dual-vehicle-and-is-confirmed-liv
parent: SP-6
status: done
depends_on:
  - SP-6_SL-1
  - SP-6_SL-2
  - SP-6_SL-3
verified_req_hash: 2e4a13784c5bf5603a79163f114368bda636e629
commit: 71a5dfa598a936ef4b695988486e5076f4410d6e
---

# Contract ships dual-vehicle and is confirmed live

Bump templates/methodology-bundle/VERSION + manifest.json and build/install the new vsix, delivering both vehicles together: the bundled skill/master text and the server gate.
Done: both confirmed live — the installed extension's move_slice gate refuses on an unchecked AC, and the reloaded bundle's skills carry the contract text and realigned seams. (Satisfies AC #6.)
