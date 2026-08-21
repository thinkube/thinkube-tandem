# The ladder — who does what, and what happens when it fails

This is the design the run is moving to, and the record of who does what
today. It exists because nothing described the actors: a person could read
every module and still not know who decides what, or where a failure goes
when the actor holding it cannot finish.

Two sentences hold the whole thing:

- **Every failure is routed to the actor best placed to settle it, and
  there is always one more actor behind.**
- **A rung with something behind it fails fast; the rung with nothing
  behind it works until the evidence says stop.**

---

## 1. What the machine is for

You write asks. The machine reads them into promises with checks, you sign
a cut of them, and it builds the work and proves it. You accept or reject a
delivery. You are never asked about the machine's internals — not about a
file, a tool, an ordering, a test. If something inside cannot be settled
inside, that is a defect of the machine, not a question for you.

---

## 2. Who does what today

### Before you sign

| Actor | Sees | Writes | Decides |
|---|---|---|---|
| Reader | your draft | nothing | which sentences are asks |
| Subject / claim deriver | the asks | the space model | subjects, and the claims under each |
| Grounder | claims, repository map, digest, code graph | promises: touchpoints + acceptance criteria | where work lands, what proves it, what cannot be verified at all |
| Door (knowledge) | the repository | cached digest and setup facts | how this repository is installed, built, and how one test runs |
| Planner | the signed cut, the code graph | slices, units, footprints, order | who owns which files, what runs after what, where each check is graded |

### During the run

| Actor | Sees | Writes | Decides |
|---|---|---|---|
| Tester | criteria, contract, digest, existing test homes | the checks (probes), in its own snapshot | how each criterion is proved |
| Coder | its brief, the contract, its own files | production files inside its footprint | the implementation |
| Maintainer | criteria and the test homes it owns | existing test files | how old tests come under the new rules |
| Verify oracle | the coder's work plus the checks, in an isolated runner | verdicts | pass or fail per check; green is the only "done" |
| Arbiter | everything: briefs, check source, the tree, and what a check prints when run | rulings | see §4 |
| Closer | everything, with authority to change anything | code and checks | how to finish what no other actor could |

### At the gate

| Actor | Sees | Writes | Decides |
|---|---|---|---|
| Assessment reviewer | the delivered tree | verdicts | criteria a reviewer must judge rather than a test |
| Repository suite | the delivered tree | verdicts | whether the tree stands — and it is the ONLY place a red nobody in the run owns is decided: every coder shares one tree, so a standing test broken in files a unit cannot edit is carried here, never charged to that unit |
| Finisher | the red tests and the delivery's files | code and tests | how to bring the delivered tree under the repository's own checks |
| Re-homer | the checks and their promises | moves checks into the repository's suite | where each proof lives on |
| You | the delivery page | accept or reject | whether this is what you asked for |

---

## 3. What changes, and why

Four changes, each with the evidence that produced it.

### 3.1 One arbiter, always reachable, that runs before it rules

Today a worker in trouble must find the right one of six doors —
challenge, diagnosis, supervision, repair, widening, cross-slice
contract — each with its own trigger, grammar and small budget. Two of
them rule by *reading*, never by running. The ledger says the pleas are
almost always honest: nine of ten challenge rulings found the check
genuinely defective, and a judge that only read a check once declared an
unpassable one faithful.

The arbiter replaces all six:

- **One door**, always available, no trigger conditions.
- **It executes before it rules.** Every ruling carries what the check
  printed when run against the worker's current tree.
- **It refuses to rule starved.** Invoked without a brief or without the
  check's source, it returns that as a machine defect — never a confident
  blind verdict. (Both happened in the last run, in the judge's own words.)
- **One grammar, all the powers that exist today**: disclose a fact, rule a
  check defective and have it re-authored, widen a footprint (validated),
  flow an obligation to another unit, or say concretely what the code must
  do.

### 3.2 Never simulate a system you do not own

A fake that stands in for **your own seam** — an interface this repository
defines and injects — is a few lines and cannot rot. A fake that
impersonates a **third-party platform** is a simulator: bigger than the code
it tests, with its own defects, and green against it proves nothing about
the real thing.

Evidence, from one cut, one day, one tester: the slice whose design takes
its host as a parameter had four checks, no fakes, no trouble. The slice
that reaches for the editor API directly needed checks that intercept the
module loader and hand back an invented platform — and produced every
expensive failure of three runs, including twelve consecutive failed
repairs of a single check.

The rules that follow:

- A check may fake **an interface this repository owns and injects**.
- A check may **not** simulate a foreign platform. Mechanically: a check
  that intercepts the module loader, or invents more than a couple of
  members of a foreign API, is refused at authoring time.
- When a promise really is about the platform's behaviour, the derivation
  either **plans an owned seam** (the work takes its host as a parameter,
  and the logic is proved there) or records the platform's part as
  **unverified, with its reason**, on the delivery's face.

### 3.3 Seams named before the plan is cut

Today the names, shapes and literals the criteria leave open are settled by
each slice's tester, in parallel, at the last possible moment, and flowed
to coders as decisions. That creates dependencies the plan cannot see: a
coder waits for its tester's vocabulary, and two slices needing the same
name can invent two.

A seam a promise introduces — a function, a field, an action, a wire
format — is named **in the promise**, at derivation, visible on the work
page before you sign. Every actor then reads one shared contract, and the
decisions channel and its dependencies disappear.

### 3.4 Isolation by worktree, not by fence

Parallel coders share one tree today, separated by procedural fences.
Every coordination failure of the last week lived there: a widened
footprint that reverted a legitimate write, obligations crossing slices,
units waiting on files nobody would write, half-committed grants.

Instead: **a worktree per slice**, off the run branch. Nothing to collide
with, so no fences are needed. Slices merge into the run branch in
dependency order as they finish; disjoint work merges in seconds, and a
true conflict goes to the bounded conflict repair that already exists. The
integration build runs at each merge, so a breaking merge is named at the
merge instead of discovered later by innocent units.

Parallel width is preserved or increased — isolation no longer costs
anything.

---

## 4. The ladder, rung by rung

A failure climbs only as far as it must, and never stops before it is
settled.

| # | Rung | Fires when | May do | Budget |
|---|---|---|---|---|
| 1 | The worker itself | always | fix its own files; read the compiler's own words through its build tool | while it makes progress |
| 2 | Mechanical routing | a failure has an obvious owner | classify: code, check, environment, another unit's; transfer, or wait only while a pending unit owns the red file | none needed |
| 3 | Check repair | a check could not run | re-author it from its criterion, with the runner's error | one attempt |
| 4 | Arbiter | anything a worker cannot settle, or any repetition | see §3.1 | one ruling per check per phase |
| 5 | Finisher | the delivered tree fails the repository's own checks | change code and tests to bring the tree under, never weakening a check | one round |
| 6 | Closer | everything above is spent | full sight, full authority, everything documented | until it is green or stops making progress |

**Authority is a fact, not a sentence.** The first run with the closer in it
proved the difference. In one unit the closer knew the fix exactly — three
lines, a missing accessor — wrote it, and the write fence reverted it,
because the file belonged to another unit that never ran. In another it was
shown a verdict reading "7/7 green" while the thing failing it went unnamed,
scored on a count of red checks that was already zero, and stopped after two
rounds by its own no-progress rule. It had every authority the brief could
give it and none the code could. So:

- **It sees what fails it.** Its evidence is the same reading the coder
  gets, the repository's own suite included — never a verdict that says
  green while the unit is held red.
- **It is scored on all of it.** Every red that holds the subject counts
  toward the number its no-progress rule watches.
- **It takes what fails it.** Whatever file the evidence names is added to
  its footprint, unless a unit running right now is writing it — two
  writers in one file is a lost update, not authority.
- **It works in the tree that is committed.** Production and checks live in
  two trees; the brief names both, and a production file written into the
  checks' tree goes back at once. A fix in a tree nobody commits is not a
  fix.

**The closer.** It reads everything, including the checks — the blinding has
already done its work by then, since the checks were written from your
signed criteria before the code existed. It may change production or a
check, but it is judged like everyone else: green is decided by execution,
and a change to a check must be justified against the criterion it proves
and is recorded as a ruling on the delivery. It is not rationed by a
pass count: it works until the evidence stops improving, because there is
nothing behind it. Its report is a precise description of what the cheap
rungs could not do, and **firings per version is the number that says
whether the machine is getting better**. The target is zero.

---

## 5. Budgets: pay for progress, not for attempts

A round that improves the count earns another. A round that repeats itself
earns nothing and hands up at once.

| Actor | Today | The ladder |
|---|---|---|
| Coder verify rounds | 20 | while progress; one repeat hands up |
| Rework attempts | 3 | 1, then hand up |
| Check repair | 2 per check | 1 — a failed repair is evidence, not a retry |
| Arbiter | six doors, 2 each | 1 ruling per check per phase |
| Tester | 300 turns | one pass, plus the mechanical checks of §6 |
| Gate finisher | 2 rounds | 1, then the closer |
| Waiting for another unit | six waits of ten minutes | only while some unit can still land something — a unit that is itself waiting lands nothing, so nobody waits on it |
| Closer | — | until green or no progress |

What this would have saved in the last run: two units spent five rounds
each repeating an unchanged verdict, and the repair spent twelve attempts
where the first failure was already the answer — roughly half the run's
cost, in motion that produced nothing.

---

## 6. What the machine checks mechanically, before any model is asked

Cheap, deterministic, and each one removes a class that has cost whole
runs:

- **A check's imports must resolve in shape**: the directory a check
  imports from must exist in the built output. The module itself may be
  missing — that is code not written yet — but a path that can never exist
  is rejected before the check leaves its author.
- **A check may not simulate a foreign platform** (§3.2).
- **A test is a file a runner can execute**, never a name that merely looks
  like one: a config file is not a check.
- **A commit carries what the unit actually touched**, including any
  footprint widened during the run.
- **The record is never silent**: every command is bounded and named, and a
  run that writes nothing for too long declares itself dead at its last
  named step.

---

## 7. What stays, because it earned its place

- Checks are written before the code, by an actor that is not the coder.
- The coder never writes a check.
- Green is decided by execution, never by a worker's own account.
- The repository's own suite is law, and a red suite is never handed over.
- Everything is on the record: rulings, transfers, widenings, undelivered
  work, and every defect row carrying the version that produced it.
- Run again resumes: committed work stands, the base merges in.
- The human boundary: asks, signing, intent questions, acceptance. Nothing
  else.

---

## 8. How we will know it worked

Not from anyone's account of it. From the ledger, which now stamps every
row with the version that produced it:

- rows per class per version — `test`-type rows should collapse as §3.2
  and §6 take effect;
- rounds lost to repetition — should approach zero as §5 takes effect;
- closer firings per version — the single measure of whether the rungs
  above it are doing their job.
