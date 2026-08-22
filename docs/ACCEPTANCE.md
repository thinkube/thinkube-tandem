# How v2.5 proves it is not a tricycle

The same rule the machine must obey applies to the machine itself: a claim
is kept when something **drives** it and the drive **fails** if the
mechanism is removed. No requirement below is "done" because it was
written, reviewed, or committed.

Each row states what is claimed, what drives it, and the falsification —
the change that must turn the drive red. A drive that cannot be falsified
proves nothing and is deleted.

## The requirements, and how each is shown

State, 22 August: **12 of the 13 rows are driven.** Row 6 is not, and cannot be as written.

| # | Claim | Driven by | Falsified by |
|---|---|---|---|
| 1 ✔ | One worktree per repository, and no others | after a run, the worktree list holds exactly one tree per repository the cut touched; no `-tester` tree and no `oracle-runners/` exist | re-introduce the tester snapshot: the drive sees the extra tree and fails |
| 2 ✔ | Checks live in the repository's own test homes | after a run, every check is at a path the repository already uses for tests; no `probes/` directory exists | write one check to `probes/`: the drive fails |
| 3 ✔ | Blinding is by permission, not by absence | a coder that reads a check path is refused, and the refusal is on the record | remove the read fence: the drive fails |
| 4 ✔ | A unit is never failed for a red it cannot reach | a run where a standing test is red for a file no unit is cleared to change delivers, with the red named for the gate | restore the rule that the suite decides the unit: the drive fails |
| 5 ✔ | The plan is refused before dispatch, not after — for the site outside a clearance and the promise naming two repositories. The third, a criterion provable only by calling a class, is NOT built: deciding it needs a fact the machine does not have | for each of: a criterion provable only by calling a class; a criterion whose site is outside its unit's clearance; a promise naming two repositories — the run refuses **before any worker starts**, naming the promise | move the check back to dispatch: the drive sees a worker start and fails |
| 6 ○ | Integration is exercised first — the ordering is written and driven, but nothing supplies the product's outer seam yet, so it is not wired | the plan's first slice drives the product end to end | order the slices with the seam last: the drive fails |
| 7 ✔ | Wiring is proven by execution | the SL-6 fixture — a register built, disposed, and connected to nothing, with every check green — is **rejected**, because the drive never executed the unit's lines | remove the trace requirement: the fixture passes and the drive fails |
| 8 ✔ | A stalled run says so and stops — and so does one that talks forever | a run with no progress writes what is open and halts itself | remove the watchdog: the drive hangs and fails |
| 9 ✔ | Nothing reaches the person except the work | every question or refusal shown to a person is free of file names, tool names and internals | feed an internals-laden question: the drive fails |
| 10 ✔ | A failed criterion returns to its author's own session | the repair arrives as the next message in the session that wrote the code, carrying the drive's evidence and what changed since | start a fresh worker instead: the drive sees a new session id and fails |
| 11 ✔ | Every repair says which stage it implicates | after a run with repairs, each row names one of: author's slip, brief lacked a fact, check misreads the criterion, clearance could not reach the site, criterion at the wrong altitude | write the row without the stage: the drive fails |
| 12 ✔ | The loop always ends — driven for silence, for the wall clock, and for a repair that stops improving; the fuzz over configurations is not written | a fuzz over run configurations — failing checks, unbuildable trees, a repairer that oscillates, a silent worker — reaches one of the three terminal states within its budgets, every time | remove the patience rule or the watchdog: a configuration hangs and the drive fails |
| 13 ✔ | Demolition is not punished | a repair that deletes a module and breaks five imports for one round is allowed to continue and finish | count import errors as unkept promises: the repairer is stopped mid-refactor and the drive fails |

## What is not driven

Row 6 — a thin end-to-end path first — is not built, and not for want of
effort. Reordering slices cannot create one: a slice that depends on three
others cannot run before them. The code map's roots are not the product's
seam either; measured on this repository it names seven, none of them the
extension's entry point. A walking skeleton is a decision made when a cut is
SLICED, and the slicer groups promises by how they couple, with no notion of
a layer that would let it put one of each in the first slice. Building it
means changing how promises are grouped — real work, and a design change
this plan does not contain.

Row 9 is driven, but narrowly and honestly: not a word list over arbitrary
text, which would pass anything phrased carefully, but the machine's OWN
refusals, produced by the real functions with real inputs, read for the two
things a person can do nothing with — the name of a tool and the name of a
part of the run. It fails when one refusal is made to mention either.

## The end-to-end acceptance

The rows above are mechanisms. The product claim is one sentence, and it is
proven exactly once, on a real ask:

> A person writes one ask in a real repository, signs, and the machine
> delivers a change that **runs and does what was asked**, with **zero
> attention events about the machine**.

Measured, from artefacts that already exist:

- *delivered and works* — the drive for the criterion runs against the
  delivered build, and the execution trace shows the new code on its path.
- *zero machine-attention* — no row in the defect ledger of that class, and
  no message to the person naming a file, a tool, or an internal.

Until that run exists, v2.5 is a design document, and I will say so rather
than report progress against the mechanisms.

## The experiment that comes first

Before any of the deletions in TARGET.md §1, one fresh run — a cut with no
prior work — measuring from the log how many criteria go red→green **inside
a unit's own rounds**. That number decides whether per-unit verification is
earning the machinery it requires. Today's only measurement is a resumed
run, where five units out of five arrived green and improved nothing, which
proves nothing about a fresh one.

## Order, and what "ready" means at each step

Each step is finished when its drive passes **and** its falsification turns
it red. Nothing moves to the next step first.

0. Run the experiment above and record the number.
1. Delete the extra trees inside each repository (rows 1–3).
2. Checks born in the repository's test homes (row 2 completes).
3. Pre-flight refusals and slice order (rows 5–6).
4. Drives and the wiring trace (row 7).
5. The end-to-end acceptance run, three times, counting attention events.

## What would make me say stop

If step 5 fails twice for reasons in the machine rather than the work, the
design is wrong and the fallback stands: v1's loop, with one
attention-reducing mechanism added at a time, each one required to lower
the attention count before the next is allowed in.
