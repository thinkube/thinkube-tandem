---
uid: worktree-canonical-spec-numbering
parent: SP-5
status: done
depends_on:
  - SP-5_SL-1
parallel: true
priority: P2
verified_req_hash: ee4075c59117edc460758e080d885254aa7887be
commit: f7a29dbc4df5e16bbe0ca78827121cd795ec4856
---

# Spec numbers stay unique across worktrees

Route Spec-number minting (`ThinkubeStore.nextSpecNumber` / the "New Spec"
path) through the canonical repo so a stale worktree view can't mint a
duplicate. Done: creating a Spec while worktrees are active — or from inside
one — yields canonical `max+1`, never a collision.
