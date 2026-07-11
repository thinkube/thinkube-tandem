---
description: Project-specific conventions for thinkube-tandem — branch naming, PR template, commit format, the verification recipe, and the worktree provisioning command. Hand-edit per project.
disable-model-invocation: true
allowed-tools: []
thinkube-bundle: 0.0.1
---

# Repository conventions — thinkube-tandem

The Tandem bundle skills (`/pair-next`, `/slice`, `/spec-prepare`) and the orchestrator load this file on demand. The `verifier` subagent reads the **verification recipe**; the orchestrator's worktree runner reads the **worktree setup** command.

## Branches

**One branch per Spec** (TEP-0010), named `spec/SP-{n}`. Every slice under the Spec lands as commits on that one branch — no per-slice branch. When specs run in parallel the branch is a worktree (TEP-0008), retired at merge.

## Pull requests

**One PR per Spec** — never one per slice. Title matches the Spec's `# heading`; body opens with a one-line summary + `Closes SP-{n}` and lists the slices delivered. Merged by the acceptance step, not hand-merged mid-Spec.

## Commits

Conventional-Commits-ish. One (or a few) commits per slice on the Spec branch, tagging the slice handle:

```
<type>(<scope>): <one-line summary>

Refs SP-3_SL-4
```

Types in use: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`.

## Verification recipe (the `verifier` reads this)

The `verifier` subagent runs the commands below to gate a slice's move to **Done**. The recipe is the source of truth — there is no separate test-suite assumption. For this repo:

- Host typecheck: `tsc -p ./ --noEmit`
- Tests (compiles the test tree, then runs `node:test`): `npm test`
- Webview build (only when the webview changed): `npm run compile:webview`

All must pass (exit 0) for a green. The test runner is the built-in **`node:test`** (`tsc -p tsconfig.test.json && node --test out-test/`) — this repo does **not** use vitest/jest; do not invoke them.

## Worktree setup

A fresh worktree (TEP-0008) is a clean checkout: it has the committed source but **none** of the gitignored dependencies a verify needs (`node_modules/`). Before the verification recipe can run green there, the orchestrator (th4wqh) **provisions** the worktree by running the single command declared in the `setup` block below, once, from the worktree root.

```setup
npm ci --prefer-offline --no-audit --no-fund
```

(produces `node_modules/`, which is gitignored — and must be matched as both a directory and a symlink so a symlinked dependency tree never leaks into `git status`.)

**No-leak rule.** Provisioning outputs are build artifacts, never thinking-space state. The runner must never `git add -A` after provisioning — `node_modules/` stays untracked, out of every commit.

## Things to never do

- `git push --force` to `main`.
- `rm -rf` against `.git/`, `node_modules/`, or anywhere outside the workspace root.
- Skip `pre-commit` / `pre-push` hooks via `--no-verify`. Fix the underlying issue instead.
- Commit secrets.
