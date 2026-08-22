# v2.5 — the design, and what decides it

Judged by two numbers and nothing else:

- **attention events about the machine, per run: zero.** Attention about the
  *work* — an intent question, a promise that cannot be observed — is
  legitimate and designed in, at two points. Attention about the *machine* —
  a stall, a dead end, a unit failed for what it cannot reach — is a defect.
- **did the delivered thing do what was asked**, proven by driving it.

Most of what follows is deletion. Where something is added, it says so.

## 0. The dimension that decides most of it: context

Three properties, and you can have two:

1. **Full context** — every actor sees the repository as it really is.
2. **Per-unit verdicts** — each round says whether *this* unit is done.
3. **Clean attribution** — a verdict is never contaminated by another
   unit's half-finished work.

v1 chose 1 and 3: everything in one tree per spec, verification at the gate.
It delivered, with a person attending when it stuck.

v2 chose 2 and 3, and paid with 1 — every actor works in a partial world.
That is where tricycles come from: a unit that can only see its own files
produces something that satisfies its own files. SL-6's register was correct
in isolation and connected to nothing; the only actor that noticed was the
closer, because it is the only one that sees the whole tree.

**Direction: A — v1's split (1 and 3), with the person's attention replaced
by gate repair rather than by per-unit verdicts.** One experiment decides it
before any deletion (§6).

## 1. One worktree per repository — and no others

A cut spanning three repositories has three worktrees, three branches, three
deliveries. What goes is every *additional* tree v2 created **inside** a
repository: the tester snapshot, and — if A holds — the composed runners.

Five mechanisms exist only because checks and grading live in other trees:

| Mechanism | Exists because | Cost |
|---|---|---|
| the emit map | checks live where the build output does not | the audit faulted correct checks |
| the probe store | the tester tree is detached and reset | restore bugs, complexity |
| re-homing | checks were never in the repository's test homes | the growth engine behind 796 tests |
| runner composition | grading needs a tree that does not exist | "the tree is not ready" reds, the cascade, both deadlocks |
| the closer's tree confusion | two trees, one clearance | its real fix for SL-6 was written where nothing commits |

Within the repository's one tree: the tester writes checks into the
repository's own test homes, the coder writes production beside them,
blinding is by **permission** (the guard refuses a coder any test-shaped
path — v1's `codeReadFence`), and the scheduler keeps two units off one
file, as v1 did.

## 2. One judgement per level

- A **unit** completes on its own claim plus a green build. Under A there is
  no per-unit verdict; the gate judges.
- The **repository gate** judges everything, once, on the whole tree.
- **Cross-repository promises** are judged at a project gate after the
  repositories' deliveries land, or declared unprovable at signing.

*Deletes:* the per-slice suite, the owner classification, the waits, and
with them both deadlock classes.

## 3. Prevention: decide it before orchestration, while a person is present

Every failure this week was decided before a worker started and discovered
during the run. A refusal before dispatch costs one interaction at a moment
you are already looking; the same defect during the run costs an hour and an
attention event. So the plan is refused, before any worker, when:

1. a criterion is provable only by calling a class — wrong altitude;
2. a criterion's implementation site is outside the clearance of the unit
   responsible for it — SL-7's class, made unrepresentable;
3. a promise names more than one repository — better still, make the
   repository a field of the promise so the state cannot be written;
4. a promise has no check site, or a check that could only read source text;
5. the slice order does not put a thin end-to-end path first — the walking
   skeleton, so integration is exercised in slice one rather than at the
   last gate.

## 4. Repair: the author, resumed, with what it already knew

A criterion red at the gate returns to the unit that owns it — **as the next
message in the same worker session**, not as a fresh worker with a brief.
The SDK takes a `resume`; the engine already captures session ids. The
author still holds its own reasoning, so intent survives the repair.

Bound by three prohibitions, unchanged from the ladder:

- it may not touch the promise — your sentence is fixed;
- it may not change a check without a ruling citing the criterion the check
  proves, recorded on the delivery — a check may be corrected, never
  weakened;
- it is judged by execution and the trace, so it cannot satisfy a check
  without wiring the behaviour.

Fallbacks in order: the session is gone → a fresh worker with the evidence;
the author cannot → the closer, with the whole tree; the closer cannot →
withheld, named per promise.

**And every repair writes which stage it implicates** — a slip by the
author, a brief that lacked a fact, a check that misreads its criterion, a
clearance that could not reach the site, or a criterion at the wrong
altitude. That is the axis today's 461 defect rows do not have, and it is
what tells you whether to improve briefs, checks, or grounding.

## 5. Convergence: how the loop is guaranteed to end

- **Build first.** A tree that does not compile is one failure, not many. A
  deletion that breaks five imports is a build failure, never five unkept
  promises.
- **Then the promise count, with patience.** Unkept promises are counted at
  round boundaries against the best seen so far; a repairer may make things
  temporarily worse while it does something structural, but not for long.
  Sustained failure to improve ends the loop; a transient rise does not.
- **Bounded rungs.** Author, check repair, arbiter ruling, closer — each
  once per failure, none re-entered.
- **A wall-clock backstop.** Silence past the watchdog's threshold ends the
  run with its report, whatever any loop believes.
- **Exactly three terminal states**: delivered; withheld with every unkept
  promise named; halted with what was open.
- **Delivery only at zero.** The branch may hold any state along the way;
  nothing is handed over until nothing is unkept. There is deliberately *no*
  rule that the branch may never get worse — that would forbid demolition.

What this guarantees: termination, honesty, and that nothing incomplete is
handed over. What it does not guarantee: that the count reaches zero. When
it cannot, the machine's obligation is to stop and say which promise it
could not keep, in your words.

## 6. The experiment that decides A before anything is deleted

The claim "gate-first loses almost nothing" is unproven. The ledger cannot
answer it — it counts surviving failures, not what a coder fixed inside its
own round. Today's log shows zero in-round improvement across five units,
but that run was a resume, where the work was already done.

**One fresh run — a cut with no prior work — counting, from the log, how
many criteria go red→green inside a unit's own rounds.**

- Units routinely climb inside their rounds → per-unit verification is
  earning its machinery, and A moves that repair to the gate. Say so, and
  reconsider.
- Units arrive green, as in the resumed run → the loop is paying for
  machinery it is not using, and A is deletion with no loss.

That run costs what a run costs, and it decides the largest question in this
document. Nothing in §1 is deleted before it.
