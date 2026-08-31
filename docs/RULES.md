# Nine rules, and what each one deletes

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

*Built as:* the discard, always. A check's source and verdict are kept on
the delivery record and the file leaves the tree. The question — does this
check catch something nothing else catches — is NOT asked, and no criterion
declares itself an invariant, because asking it needs somebody to answer
and every automatic answer is the growth engine again by another name. So
today no check ever joins the standing suite. When a check should have
stayed, that is a person's decision, made by reading the delivery.

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

## 9. A file holds one nameable thing

A file holds one nameable thing, and is named after it. Its opening sentence
says what that is — one sentence, without "and". A change that does not fit
that sentence belongs in another file.

This replaces a limit of six hundred lines that lived only in
`hygiene.test.ts`, written down nowhere a person read. It went in after the
machine produced files of five thousand lines and it stopped that — but a
line count is satisfied by deleting the explanation rather than extracting
the code, which is the cheaper move and the worse one. Four files were
compressed instead of split in a single afternoon under it. Measured against
its own tree it moved little: the median module is about a hundred lines of
code with or without it, and the largest files sit in the directory it
exempted.

The count also cannot see what it stands in for. `plan.ts` opened with
"execution locks, per-slice probe and test-home maps, the closing gate's
verification list, the honesty scan, the delivery record, documentation
obligations, and the roles' invariant" — seven things and two "and"s in
three hundred and sixty-two lines, inside every limit anyone proposed and
plainly a bag. A reader sees it at once; no number ever will.

No major style guide sets a line limit. Java requires one top-level class per
file, Go makes the package the unit, Rust maps modules to files, and ESLint's
`max-lines` is off by default and ships `skipComments`.

So the shape of the modules is reported and never enforced: the delivery says
how many files there are, the largest, the median, the average, and how much
of the tree explains rather than instructs. Growth is visible without being
punished.

*Remedy, which the old rule never named:* **extract a nameable piece; never
compress the prose.**

## 10. What only the checks use never ships

A file the product does not load has no business in the product. Support a
check needs — fixtures, scripted workers, tiny repositories built to be
torn down — is named `*.fixture.ts` and left out of the shipped build by
`tsconfig.json`, beside `*.test.ts`.

The reachability gate cannot see this. A check is an importer, so anything
a check imports looks used, and support code sitting in product source
passes every gate while being compiled into what people install.

*Remedy:* **name it a fixture, and let the build exclude it.**

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
| 9 one nameable thing | a line limit, and the incentive to delete explanation | a sentence a reviewer reads |

Five rules delete more than they add. Two are free. One is an honest
addition. If a future rule cannot fill the middle column, it does not
belong here.
