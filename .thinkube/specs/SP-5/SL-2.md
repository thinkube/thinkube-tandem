---
uid: worktree-retire-refuse-dirty
parent: SP-5
status: done
depends_on:
  - SP-5_SL-1
parallel: true
priority: P2
verified_req_hash: ee4075c59117edc460758e080d885254aa7887be
commit: f7a29dbc4df5e16bbe0ca78827121cd795ec4856
---

# Retire a Spec's worktree, refusing when dirty

A "Retire" action removes a Spec's worktree via `WorktreeService.remove`,
refusing when the worktree has uncommitted or un-pushed work (no silent data
loss) and removing it cleanly otherwise. Done: retiring a merged Spec removes
its worktree; retiring a dirty one is refused with a clear message.
