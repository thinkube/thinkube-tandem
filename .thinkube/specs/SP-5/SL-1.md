---
uid: worktree-start-spec-rooted-session
parent: SP-5
status: done
priority: P2
verified_req_hash: ee4075c59117edc460758e080d885254aa7887be
commit: f7a29dbc4df5e16bbe0ca78827121cd795ec4856
---

# Start a Spec in its own worktree, session rooted there

A "Start Spec" action on a spec/board node creates a dedicated git worktree
on branch `spec/SP-{n}` from the canonical repo (via a new `WorktreeService`
with a `canonicalRepo(cwd)` resolver using `git rev-parse --git-common-dir`),
then opens a Claude session rooted in it through `LauncherService.openHere`.
Done: clicking Start opens a session whose cwd is a fresh worktree on its own
branch; a second Spec started the same way is physically isolated — its
`git status`/commits never see the first's edits. Exercises the spikes
(worktree under code-server/Mac, `--git-common-dir`, wrapper-roots-at-worktree).
