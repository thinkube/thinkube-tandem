---
uid: slice-skill-creates-via-tool
parent: SP-4
status: done
depends_on:
  - SP-4_SL-1
priority: P2
verified_req_hash: 2db2bf6e1da1b39d4a3c63902ffefe45d9d7a0fe
---

# /slice creates through the tool, both vehicles delivered

Swap the skill's step 6 from freehand Write to one `create_slice` call per
agreed slice; add the safety rule "kanban tools absent → stop and tell the
user"; bump the bundle and ship the new vsix — both delivery vehicles must
land. Done = a fresh `/slice` run's transcript shows the cards created via
`create_slice` calls and the files are canonical.
