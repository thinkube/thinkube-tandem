---
uid: a-worktree-shares-its-canonical-spec-s-board
parent: SP-9
status: done
satisfies:
  - 3
verified_req_hash: 34e1de85cdc6b841925ea9ae82ee3ba4c5b7c258
commit: 1c8121cff9c8fe0513dda157dc7be159e7b43f20
---

# A worktree shares its canonical Spec's board

Both discovery walks (BoardNavigatorProvider.walk + the MCP walkForBoards) resolve a linked worktree's board dir from its canonical repo's namespace (linkedWorktreeInfo → namespaceForRepo(canonicalRepo)) instead of the worktree's own out-of-folder path (which falls back to a co-located .thinkube/).
Done: a worktree and its canonical repo render the same sidecar board; a worktree carries no co-located board. (Satisfies AC #3.)
