---
uid: move-slice-done-refuses-on-an-unchecked-satisfie
parent: SP-6
status: done
parallel: true
verified_req_hash: 2e4a13784c5bf5603a79163f114368bda636e629
commit: 39e60caeffeef6a8041d028ee197d7fcccfcb3c5
---

# move_slice → Done refuses on an unchecked satisfied AC

Structured slice→AC mapping flows end-to-end: frontmatter.ts gains satisfies?: number[], create_slice accepts it, and the /slice skill records it from its coverage step. move_slice → Done verifies each listed ordinal is a checked - [x] in the parent Spec's ## Acceptance Criteria; any unchecked → refuse, naming the ordinal and its text. Legacy slices (no satisfies) pass with gateSkipped: "no satisfies field".
Done: stdio harness shows refuse-while-unchecked → allow-after-checking → legacy-passes-with-skip; typecheck + webview build + tests green. (Satisfies AC #5.)
