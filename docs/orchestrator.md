# The orchestrator and its closing gate

The orchestrator drives a Spec to completion autonomously: it schedules the Spec's
work-units over their DAG, runs each as a worker, and — when every unit has landed —
runs a **closing gate** before the Spec is allowed to reach Done. This document covers
the closing half (SP-tgzyfy / TEP-tgzx3p): the mandatory per-AC verification, the
auditable delivery report, and the human **Accept / Reject** exits.

## The closing gate

At **Spec quiescence** (all units landed in the worktree) the orchestrator does **not**
silently mark the Spec Done. It runs the **acceptance criteria's declared verifications**
as a complete plan, and gates Done + commit on the result:

- **All green** → it checks exactly the satisfied AC ordinals on the Spec, advances the
  slices to Done, commits the worktree to `spec/SP-{n}` once, and writes the report.
- **Any red or un-runnable** → it leaves the Spec **`requires-attention`**, commits
  **nothing**, and still writes the report (the failure is auditable).

There is **no skip**. The previous `defaultVerify` skip-pass is gone: a Spec whose ACs
cannot all be verified is never advanced to Done on an un-run verification. This is the
regression TEP-tgzx3p corrects.

### Declaring how each AC is verified

A Spec declares an **`ac_verifications`** map in its frontmatter — AC ordinal → how it is
checked:

```yaml
ac_verifications:
  1: { run: "npm test", env: local }
  2: { run: "ansible-playbook 18_test.yaml", env: cluster }
```

`run` is a shell command or playbook; `env` is `local` or `cluster`. The closing gate
runs the **union** of these checks in dependency order — for an infra component that means
the real lifecycle (`install → test → rollback → re-install`), not just the test step —
and attributes each result back to the AC(s) it proves. `orchestratorCore.runAcVerifications`
is the pure runner; the real spawn is behind an injectable seam so the whole gate is
unit-testable without a live cluster.

## The delivery report (`DELIVERY.md`)

On **every** completion — pass or fail — the gate writes a durable, non-ephemeral report to
`specs/SP-{n}/DELIVERY.md` (kept out of the Spec body so it never trips the staleness hash
on the Done slices). It records:

- the commit the Spec landed at (or "not committed" on a red gate),
- each execution unit's outcome,
- any worker-reported problem caught this run,
- a **per-AC pass/fail table with the verification evidence** — proof of _how_ each AC was
  verified (and, on a failure, proof of _why_ the gate stalled),
- the union of the units' touched files.

The report auto-opens rendered in the Markdown preview when a run finishes.

## Accept / Reject

The finished report surfaces two human exits on the acceptance/close surface:

- **Accept** performs the gated merge of `spec/SP-{n}` → `main`. It is **refused unless every
  AC is checked** — there is no accepting an unverified Spec.
- **Reject** opens a Claude session primed with the report's context — the spec-level analog
  of `/attend` — to rework the Spec from the evidence of what failed.

The webview posts `accept` / `reject` messages (carrying the Spec id) that the host forwards
to the corresponding `thinkube.*` commands, reusing the TEP-0010 acceptance close-card rather
than a parallel mechanism.
