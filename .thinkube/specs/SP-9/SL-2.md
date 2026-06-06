---
uid: start-spec-in-worktree-gated-context-aware-from-
parent: SP-9
status: done
parallel: true
satisfies:
  - 1
  - 2
verified_req_hash: 34e1de85cdc6b841925ea9ae82ee3ba4c5b7c258
commit: 1c8121cff9c8fe0513dda157dc7be159e7b43f20
---

# Start Spec in Worktree: gated, context-aware, from code repo

SpecsProvider computes hasOpenWork + carries the code repoPath on SpecNode + sets contextValue spec-open/spec-done; package.json gates the Start menu to spec-open; worktree.ts cuts the worktree from node.repoPath (not the sidecar) and prefixes /pair-start only when there's open work.
Done: the button shows only on Specs with open (Ready/Doing) slices and opens a /pair-start session on a worktree cut from the code repo; hidden on a done Spec. (Satisfies AC #1, #2.)
