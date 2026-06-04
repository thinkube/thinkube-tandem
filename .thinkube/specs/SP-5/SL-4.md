---
uid: worktree-labeled-boards-under-repo
parent: SP-5
status: done
depends_on:
  - SP-5_SL-1
parallel: true
priority: P2
verified_req_hash: ee4075c59117edc460758e080d885254aa7887be
commit: f7a29dbc4df5e16bbe0ca78827121cd795ec4856
---

# Worktrees show as labeled boards under their canonical repo

Teach discovery (navigator `discoverRepos` + MCP `BoardRegistry`) to detect
linked worktrees (`--git-common-dir` ≠ `--git-dir`) and group/label them
under their canonical repo rather than listing them as rogue top-level boards.
Done: with a worktree active, it appears as a labeled "SP-{n} worktree" of its
repo in the navigator, and the MCP board list agrees.
