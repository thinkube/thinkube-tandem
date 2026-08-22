# Eight rules, and what each one deletes

These came out of a week in which the machine ran 140 times and delivered
nothing, while its own test suite reported 796 passing checks and 91%
coverage. Every rule below names the failure it prevents and — this is the
point — what it removes. A rule that only adds machinery is the disease,
not the cure.

The original problem was never "are the tests passing". It was: **you ask
for a car and you get a tricycle.** Something that satisfies the
description and is not the thing. Every rule here serves that.

## 1. A criterion must be drivable from outside the product

If the only way to prove a promise is to call a class, the promise is at
the wrong altitude and grounding sends it back.

*Prevents:* a set of green parts, which is exactly what a tricycle is.
*Deletes:* per-criterion scaffolding at unit seams — the fake objects, the
in-isolation assertions, and the contract text they were written against.
*Costs:* one refusal at grounding.

## 2. Wiring is proven by execution, not by assertion

The drive must actually execute the code the unit wrote, and that is read
from a trace, not from a claim. A stub can satisfy an assertion; it cannot
appear on the execution path of a drive it is not connected to.

*Prevents:* the run where seven checks passed over a register that nothing
called — built, disposed, and wired to nothing.
*Deletes:* every source-text check ("the file contains X"), and the
guessing about whether an implementation is real.
*Costs:* coverage recorded during the drive. This is the one place where
new machinery is warranted, because it replaces judgement with a fact.

## 3. What cannot be driven is declared unprovable, at signing

Never substituted with a unit-level check. The person accepts it knowingly,
or the promise is re-grounded until it can be observed.

*Prevents:* the silent downgrade that lets an unverifiable promise wear a
green tick.
*Deletes:* nothing — it uses the sign gate that already refuses a cut whose
changes cannot be proven.
*Costs:* nothing.

## 4. A unit is judged only by its own criteria

The repository's standing suite is the closing gate's business, once, on
the delivered tree, where every file is reachable and the finisher and the
closer can act.

*Prevents:* four units with every one of their own checks green, reworked,
closed and failed for one standing red in files they were not cleared to
touch.
*Deletes:* the whole ownership arithmetic — `suiteAcceptable`,
`suiteWaitsForTree`, the code/tree/elsewhere classification in the decision
path, the waits it drove, and both deadlocks that lived in those waits.
*Costs:* breakage is found at the gate rather than at the slice that caused
it.

## 5. Re-homing is not automatic

An intent check joins the standing suite only if it catches a defect
nothing else catches. Otherwise its proof is recorded on the delivery and
the file is discarded. A criterion declares whether it is an **invariant**
(true forever) or a **transition** (true once, at the moment of a change);
a transition is graded at its gate and never re-homed.

*Prevents:* the growth engine — N promises delivered means N new permanent
tests, forever, whether or not the behaviour is at risk. And the rename
gate that still fails runs months after the rename, on any sentence that
mentions the old word.
*Deletes:* the automatic re-home path, and every one-time check now living
in the standing suite.
*Costs:* one question per check.

## 6. An incident in a known class strengthens the invariant

It may not add another example. If the invariant cannot express the new
incident, that is the finding: the invariant was wrong, and it is widened.

*Prevents:* three tests for one deadlock, none of which stopped the next
variant, because each pinned an instance ("SL-6 asleep holding
extension.ts") rather than the property (*a run always ends*).
*Deletes:* instance regressions, which is most of what a bad week adds.
*Costs:* nothing.

## 7. A fix names what it removes

Or states plainly why nothing can be removed. Every repair that only adds a
mechanism adds a new way to fail quietly.

*Prevents:* the week this document came from — a door, a wait, a mend, a
closer, an ownership rule, each fixing the last one's damage.
*Deletes:* by construction, one thing per fix.
*Costs:* the discomfort of justifying an addition.

## 8. Silence is an event

Every run writes its log to disk as it happens. A run that goes quiet for
long enough says so, names every open unit and what it waits for, and then
ends itself with a report.

*Prevents:* half-hours spent watching a dead run that looks exactly like a
working one, and diagnosis by reading file timestamps from outside.
*Deletes:* nothing.
*Costs:* about 150 lines. The only unambiguous addition here, and the one
that turned a fifteen-minute reconstruction into a five-minute read.

---

## The ledger

| Rule | Removes | Adds |
|---|---|---|
| 1 criteria drivable | unit-seam scaffolding | a refusal at grounding |
| 2 wiring by trace | source-text checks, stub guesswork | coverage during the drive |
| 3 unprovable declared | the substitution path | — |
| 4 unit judged by its own | ownership arithmetic, tree-waits, two deadlock classes | — |
| 5 re-homing gated | the growth engine, one-time checks | one question |
| 6 invariants over instances | instance regressions | — |
| 7 a fix names its removal | one mechanism per fix | — |
| 8 silence is an event | — | the log and the watchdog |

Five rules delete more than they add. Two are free. One is an honest
addition. If a future rule cannot fill the middle column, it does not
belong here.
