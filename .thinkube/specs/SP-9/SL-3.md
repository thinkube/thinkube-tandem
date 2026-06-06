---
uid: retire-a-worktree-cleanly-pure-code-board-untouc
parent: SP-9
status: done
parallel: true
satisfies:
  - 4
verified_req_hash: 34e1de85cdc6b841925ea9ae82ee3ba4c5b7c258
commit: 1c8121cff9c8fe0513dda157dc7be159e7b43f20
---

# Retire a worktree cleanly — pure code, board untouched

Verify (and trim any residual board assumption in) WorktreeService.remove: it removes the worktree's working dir refusing dirty/un-pushed work, and the sidecar board is untouched (the board no longer lives in the worktree).
Done: retiring a worktree removes it and leaves the Spec's board intact — no stranded card. (Satisfies AC #4.)
