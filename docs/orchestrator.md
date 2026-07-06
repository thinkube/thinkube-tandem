# The orchestrator and its closing gate

The orchestrator drives a Spec to completion autonomously: it schedules the Spec's
work-units over their DAG, runs each as a worker, and — when every unit has landed —
runs a **closing gate** before the Spec is allowed to reach Done. This document covers
the closing half (SP-tgzyfy / TEP-tgzx3p): the mandatory per-AC verification, the
auditable delivery report, and the human exits — which are derived from the run's actual
**terminal state** (SP-11/2), not a fixed pair glued onto every outcome.

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
on the Done slices). It is the **operator's document**, written human-first: the plain-language
"what happened" leads, the criteria read in the Spec's own words, and the raw runner output is
demoted to a trailing appendix. Its sections appear in a fixed order:

1. **`# Delivery — …`** — the title, then a one-line orchestration summary (branch, sha, slices
   advanced, units run, committed or not).
2. **`## What happened`** — plain language. On a **failure** (nothing committed _or_ any AC red)
   this is the closing-gate judge's diagnosis rendered **verbatim and unclipped** — the flowing
   prose an operator reads first, never truncated. On **success** it is a plain summary of what was
   delivered.
3. **`## Acceptance criteria`** — one row per declared AC. When the gate passes the Spec's criterion
   lines (`acTexts`), each row reads `#k — <criterion text> — <verdict>` (`✓ pass` / `✗ fail` /
   `· not run`); otherwise the older ordinal-only table (`| AC | Verified by | Env | Result |`)
   remains. When no `ac_verifications` are declared, the no-skip warning takes this section's place.
4. **`## Discoveries & recommendations`** — each out-of-scope finding a worker reported (under a
   trailing `## Discoveries` heading in its output), rendered with **both** its unit id and its text,
   collected verbatim (no model-side summarizing). Empty ⇒ the literal `none reported`.
5. **`## Files`** — the union of the units' touched files.
6. **`## Next`** — the operator's exits (Accept / Reject on a committed Spec; resolve + re-run on a
   red gate).
7. **`## Evidence appendix`** — the demoted machine/audit record: per-AC **fenced evidence blocks**
   (the raw runner output, proof of _how_ each AC was verified and, on a failure, _why_ it stalled),
   the structured **verification trace** table (per AC, per rework round), the per-unit outcomes, and
   any caught problems. Demoted — not deleted.

The judge's diagnosis no longer dies unused: the full text renders in **What happened**, the
intent-framed divergence that primes attended `/attend` and Spec-level Reject sessions is derived
from it (`stripFailingCheck(extractDiagnosis(report))`), and on a **fault-test** verdict it reaches
the next test author (`buildTestReworkContext` — `route: "test"` only; code authors stay fully
redacted). The human document itself is never redacted.

The report auto-opens rendered in the Markdown preview when a run finishes.

## Exit states and their actions

The post-orchestration surface derives its exits from the run's **terminal state** rather than
offering a fixed Accept/Reject pair on every outcome. `orchestratorCore.deliveryExitState({
committed, gatePassed })` is the single source of truth — it maps the run to one of two states,
each carrying its own ordered exit set. Both the delivery report's `## Next` section and the
graph's buttons render from _this same_ set (no second derivation), and "Reject" is retired from
the UI vocabulary.

### Delivered

`committed && gatePassed` → **delivered**: the change committed and the closing gate passed. Its
exits, in order:

- **Accept & merge** (`accept`) — performs the gated merge of `spec/SP-{n}` → `main`. It is
  **refused unless every AC is checked** — there is no accepting an unverified Spec.
- **Request changes** (`request-changes`) — opens a Claude session primed with the report's
  context (the spec-level `/attend` prefill) to steer the delivered change back in line with the
  intent.

### Stalled

Anything short of delivered — not committed and/or the gate did not pass — is **stalled**. It
offers the actions that actually apply to a run that did not deliver (no impossible Accept, no
mislabeled Reject), in order:

- **Attend** (`attend`) — opens a primed `/attend` session on the requires-attention slice(s) to
  bring the behaviour back in line with the intent.
- **Re-run** (`rerun`) — re-runs the orchestrator once the requires-attention slice(s) are
  resolved.

Every action gives instant pending feedback and is idempotent: a double-click is refused, never
double-dispatched. The attend / rework prefills invoke the `/attend` skill (TEP-11/SP-1) —
`buildAttendPrompt(handle, divergence)` at slice grain and `buildRejectPrompt(specId, divergence,
projectThinkingSpaceId?)` at Spec grain each emit a `/attend …` invocation (plus the
intent-divergence summary, routed through `stripFailingCheck` so the failing AC ordinal / command
/ output never leak) rather than raw prose.

The webview posts the chosen exit's `id` (carrying the Spec id) that the host forwards to the
corresponding `thinkube.*` command, reusing the TEP-0010 acceptance close-card rather than a
parallel mechanism. The `thinkube.reject` command may remain as a compatibility alias, but no
surface labels an exit "Reject".
