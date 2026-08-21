# The words this machine uses about work

A run failed because two different facts were called by the same word.

`makeWiden` looks for the unit whose list holds a path and calls it the
**owner** (src/run/owner.ts:152). One caller then reads that word and moves
the *obligation* to that unit: "the change in this file crosses to SL-2 —
flowed as that unit's contract" (src/run/answers.ts:100). A fact about who
may write a file became a fact about who is answerable for a promise. The
promise was SL-7's, about a session carrying its space's name; SL-2 has a
different responsibility entirely, and it was asked to keep SL-7's word.

Nothing in the code owns anything. A unit **creates, changes or deletes**
files, and the plan says in advance which. This document fixes the words so
that the two facts can never be confused again.

## What is in use today

| Word, as used | Where | What it actually denotes |
|---|---|---|
| footprint | 60 source files, 8 documents | the array of path strings a unit may write |
| owner, owns, ownership | ~90 sites | **two different things** — see below |
| belongs to others | the worker's brief | the same array, from the outside |
| your lane | the worker's brief | the rules around that array |
| fence, containment, guard | 45 sites | the code that restores an uncleared change |
| stray | 9 sites | a change that is not in the array |
| touch, may touch, may edit | 10 sites | write |

### The word that carries two facts

- **Permission**: "the path is in this unit's array". `makeWiden`,
  `containmentViolations`, `frontier`, the commit book.
- **Responsibility**: "this actor must repair this failure". `ownerOf`,
  `SuiteOwner`, `suiteStanza`, the transfer rules.

Both are spelled `owner`. The first is a lock; the second is accountability.
The bug above is one step of reasoning from the first to the second.

## The words from here

| Say | Never say | Means exactly |
|---|---|---|
| **cleared to create / change / delete `path`** | owns, holds, has in its footprint | the plan lists that action on that path for that unit |
| **the clearance** (of a unit) | its footprint, its lane | the list of actions the plan cleared |
| **the guard restored an uncleared change** | the fence reverted a stray | `git restore` ran on a path with no clearance |
| **responsible for** (a criterion, a failure) | owns | who must make it right; never derived from a clearance |
| **being changed right now** | owned by a pending unit | another unit is writing that path at this moment |

Two rules follow from the words, and both are load-bearing:

1. **Responsibility never moves because of a clearance.** The unit
   responsible for a criterion writes whatever the criterion needs. If it
   lacks the clearance, it asks and a supervisor rules — the ruling is
   recorded on the delivery. A clearance held by another unit is not a
   reason to refuse; a path being written *at this moment* is a reason to
   wait.
2. **A clearance names the action.** "create `src/x.ts`", "change
   `src/y.ts`", "delete `src/z.test.ts`" — not a bare path. The plan can
   then be checked against itself: a criterion whose only implementation
   site is a file no clearance names is an impossible promise, and the
   planner is told before a worker is dispatched.

## Asking for a clearance: what happens, case by case

A unit finds that a criterion it is responsible for needs a change it is not
cleared to make. It says so. A supervisor rules on ONE question: does this
criterion require that change. Everything else is scheduling.

A granted clearance always ends in the change being made. It is a key, not
a permit to file a request: whoever gets it goes and does the work, in the
same session, before doing anything else.

| The path is | The ruling | What happens next | Who is responsible |
|---|---|---|---|
| cleared to nobody | granted | the clearance is added and the unit makes the change now | unchanged — the asking unit |
| in another unit's clearance, that unit has not started | granted | both are cleared; the scheduler already refuses to start two units cleared for the same path at once, so they run one after the other | unchanged — the asking unit |
| being changed right now by another unit | granted, and the answer is held | the asking unit waits at the door — its session stays open — until that unit finishes, and then makes the change in the same session | unchanged — the asking unit |
| test-shaped, and the asker writes production | refused | the checks are the test author's; the unit reports what it cannot keep | the test author, for the check |
| not required by the criterion | refused, with the reason | the unit finishes what it can and names the rest as undelivered | unchanged — the asking unit |

Four properties this must have, and each is a rule, not an intention:

- **No transfer.** In every row the responsibility column is unchanged. A
  clearance moves; a promise never does.
- **Granted means done.** An approval is never recorded as an obligation for
  later. The only outcomes of a grant are the change made, or the unit
  failing on the merits of the work itself.
- **A waiting unit holds nothing.** A unit waiting at the door is changing
  nothing, so its own paths are free for anyone else waiting. Two units
  cannot wait for each other.
- **A failure releases.** When the unit changing a path fails, the path is
  no longer being changed and the waiting unit is let in at once.

And the plan is checked against itself before any of this: a criterion whose
only implementation site is a file no clearance names is an impossible
promise, and it is reported to the planner rather than discovered by a
worker four rounds in.

## What changes in the code

- `WorkUnit.changes: { action: "create" | "change" | "delete"; path: string }[]`
  is what the planner writes. `footprint` remains as the derived list of
  paths, because git takes paths — it is a projection, never the source.
- The guard, the scheduler and the commit book keep reading paths.
- `makeWiden` refuses only a test-shaped path and a path being written at
  this moment; a clearance elsewhere is not a refusal.
- The cross-slice transfer is deleted, with the note it wrote.
- Every comment, brief line, log line and document uses the table above.
