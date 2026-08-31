# What changes next, and why

A plan, written after three days on `surface-fix` delivered a surface where
every page renders at zero height with 391 checks green behind it. It is
kept here, beside PROCESS.md and TARGET.md, so both of us read the same
copy.

## What went wrong, in one paragraph

Nineteen asks about a user interface became one cut: 62 promises, 41 slices,
190 proofs, one gate, one delivery, three days. Every proof was honest and
the product was unusable, because no check anywhere ran the product and
looked at it — the criteria became assertions about the text of source
files, which is the only thing the machine could prove. The stubs and the
cheated tests that Tandem was built to cure stayed cured; nothing this week
failed that way. What failed is that an error costs three days to discover
and a full rerun to correct, so every judgement got fought over instead of
fixed, and thirteen controls accumulated around a question nobody was
asking.

## The four changes

### 1 · The spec comes back

v1 had four levels: **TEP → SP → SL → AC**, and the spec was the unit of
dispatch — `src/engine/dispatchGuard.ts` still says so: *"invocations for
different Specs run unimpeded"*. v2 collapsed TEP and SP into `Cut`, so
everything signed became one dispatch, one gate, one delivery.

The spec returns **between the promise and the slice**. The asks, subjects,
claims and promises of v2 stay exactly as they are — they are the gain of
v2 and nothing here touches them.

A spec is a set of functionality that makes sense to deliver together, and
it is chosen on the first screen, before any grounding, from the subjects
already there. Subjects alone do not cluster — seventeen subjects over
nineteen asks gave seventeen groups, because a subject is one ask's noun
phrase. The grouping is one level up and it is a judgement about meaning: a
model proposes the piles, the person corrects them. Seventeen nouns into
five piles is a minute's work and it decides everything downstream.

For the record, the five that `surface-fix` should have been:

| spec | asks |
|---|---|
| I can read the run graph | cards labelled by promise · tester/coder tellable apart · the audit card's counts · never green while a worker hasn't passed · readable zoomed out |
| I can open anything and see why | every criterion with its verdict · panels open with content · the closing gate's log reachable · a pass shows its log |
| the surface speaks one language | a refused press says why · one name per action · no instruction points at a page that does not exist |
| the layout is stable, nothing said twice | the tab row stays put · the tab changes only when I change it · asks in one place · the notice said once · one place that says something is happening |
| I can act on what it is waiting for | staged implications shown and applicable · one place to answer a parked worker |

**Note which one holds the ask that broke everything.** Had "the layout is
stable" shipped alone, the window would have opened one centimetre high on
the first afternoon and the other four would have been built on a surface
that worked.

### 2 · Four places a criterion can be settled, not two

The before/after-merge split in the five-targets plan is right and
incomplete.

| | settled | vetoes |
|---|---|---|
| **A** | here, without running the product — a check runs and answers | yes |
| **B** | here, by running the product and measuring it — rendered in a harness or a browser, read by a machine | yes |
| **C** | after the merge, by a machine elsewhere — CI steps, cluster smoke tests, `18_test.yaml` | no — it answers by itself, and the harvest reports it |
| **D** | only by a person, using the running thing | no — and it should be nearly empty once B exists |

**B does not exist in Tandem today**, and nearly every surface ask lives
there. That single absence explains the week: with only A available, "the
tab row stays in one place" could only become "the `data-tabs` row is
rendered before X in the JSX".

Category D shrinks to almost nothing once B exists. The 1cm bug was found
by measuring the DOM, not by looking.

**Nothing here produces a list to work through.** A criterion this gate
cannot settle does not become an outstanding item, a pending proof or a box
to tick — this week's delivery carried twenty-one observations that nobody
was ever going to certify, which is the same mistake in its current form. It
becomes an instruction to whoever exercises the deployed thing, and its
normal outcome is silence.

Prefer, wherever the choice exists, **a check that interrogates the running
world over a check somebody wrote.** Nobody authors reality, so nobody can
fake it — which is the same honesty the tester's separation buys, obtained
more cheaply.

### 3 · The light loop

```
spec  →  build  →  light gate  →  merge & deploy  →  the look  →  feedback
```

- **build** — tester writes the checks, coder builds. **Unchanged.** This is
  what cured the stubs and the cheating and none of this week's failures
  came from here.
- **light gate** — the gate **keeps its machinery**: grading, the hand-back
  to the author that wrote the code, the closer, the repository suite, the
  product build, the two vetoes. None of that is thrown away; all of it does
  real work on the criteria it can actually settle.

  What leaves the gate is not machinery but a **class of criterion**: the
  ones that cannot be settled during a dev iteration. A criterion needing
  the deployed thing, or an appearance with no category-B check yet, is
  **not graded here at all** — and it does not become an item either.

  **It becomes part of what the look is told to exercise.** *"The closing
  gate's log is reachable in one gesture"* is not an open box on a report;
  it is a line in the brief of the worker that opens the deployed thing on
  that ask. The worker clicks, and either says nothing or says what it
  found. Nothing is outstanding, nothing accumulates, nobody has to
  remember to come back — silence is the normal answer.

  The gate is "light" because it is asked fewer questions, not because it
  has fewer faculties.
- **merge & deploy** — a consequence of green, not a decision.
- **the look** — a worker per ask, driving the **deployed** thing, writing
  what it finds. Playwright where there is a UI; the cluster's own state
  where there is not.
- **feedback** — its findings land as work on the ask that owns them.
  Routing is a lookup: the slice whose footprint holds the file, the promise
  whose touchpoints include it.

What the gate stops being asked, and why:

- **the assessment panel shrinks to what a tree can honestly answer.** Its
  61 reviews exist *only* because there was no way to look at the product:
  a model reads code and imagines a rendered card. Across this cut's life 24
  of 61 disagreed with themselves, twelve of them an isolated red between
  two greens. Each one becomes either a category-B check or a line the
  post-deploy look reports on. What is left — a genuine judgement about the
  tree that no check can make — is still graded here.
- **appearance criteria leave**, because during an iteration there is
  nothing rendered to judge. They come back as B checks once B exists, and
  until then they are answered by the look.
- **criteria settled after the merge leave** — CI steps, cluster health,
  `18_test.yaml`. They were never this gate's to answer, and they answer
  themselves: a pipeline passes or fails, and the harvest says which.

What the gate keeps, unchanged:

- **the two vetoes** — an unkept promise, and a product that does not work.
- **the repair ladder** — a red check goes back to the author that wrote the
  code, in its own session, with the evidence. That is the cheapest repair
  in the system and it works.
- **the closer** — for a genuine unkept promise nobody else could settle.
  It is a last resort, and with a spec-sized cut it will rarely be reached.
- **the suite and the build.**

The gate is "light" because it is asked fewer questions, not because it has
fewer faculties. Three days of machinery here is not thrown away; it is
pointed only at what it can actually decide.

Two properties keep the look safe: it writes **feedback, never a verdict**
(nothing it says can withhold anything, which is what keeps it blameless),
and it is **scoped to one ask** (*"open the intent tab and tell me whether
the asks section is usable"* has an answer; *"check the surface"* does not).

### 4 · The gate's weight is set by the target

> The weight of the gate should be set by the cost of being wrong, and that
> cost is a property of the target, not of the methodology.

Today it is fixed at maximum for everything, so a CSS value and a change to
the judging rule pay the same three days.

And the cost of being wrong includes **how much disruption the owner will
accept — which is the person's call, never the machine's.** A veto is the
machine deciding that on their behalf.

## The six targets under the light loop

| | deploy | the look drives | applies |
|---|---|---|---|
| **0 · this extension** | `deploy.sh` + reload; prior vsix kept | the webview, via the harness and a served bundle | fully |
| **1 · template `tkt-*`** | copier update + push; scratch deployment | the deployed app's URL | fully, minutes per look |
| **2 · app in `apps/`** | push fires the whole pipeline unprompted | the app's cluster URL | fully — the best fit; prove it here |
| **3 · thinkube-control** | template-shaped, as case 1 | control's own UI | fully — same as 1 |
| **4 · playbooks** | person-approved run against real nodes | the cluster's state | testless variant, below |
| **5 · installer** | `dev-services.sh` for the wizard; a clean node for the install | the wizard, headless | wizard fully; the install by attestation |

Case 0 has one wrinkle: deploying the extension disturbs a run in flight.
"Deployed" for case 0 therefore means *the built bundle, served and driven* —
deterministic, and no editor in the way.

### Case 4 is testless

Ansible is declarative, so a check asserting what a task declares is testing
Ansible, not the work. The verification is in the tool:

```
lint + syntax-check  →  --check --diff  →  run  →  run again
```

`failed=0` is the verdict. A second run reporting any `changed` means the
playbook is not idempotent — a real defect nobody writes a test for today.
No tester unit, no probe files. Reality is the check, and nobody can fake
convergence.

`18_test.yaml` survives for behaviour *beyond* declared state — the endpoint
answers, the token authenticates. That is category C.

Caveat: idempotence-as-oracle will flag every `shell`/`command` task without
a proper `creates`/`when` guard. Correctly — but expect a first pass to find
several.

## What happens to the 190 checks

**Keep almost all of them.** They are real work and this plan does not throw
them away.

- **~74 are pure logic** — `promiseLabelOf`, `stateFace`, `sliceCheckTally`,
  `subjectKey`, `refusalSentence`, `surfaceRegions`, `nextView`. They test
  functions against values. They stay exactly as they are, and they stay
  category A. Pure logic has no world to interrogate.
- **6 are source-text proxies** — reachability, module size, "the same
  function object as". These are the repository's own hygiene, not the
  person's asks, and they stay as they are too. They were never the problem;
  what was wrong was letting them withhold a delivery.
- **The remainder need a pass by hand**, one at a time. Many are logic
  wearing UI words and stay; the ones that assert *source text as a stand-in
  for appearance* — "the handle appears literally in the source", "the union
  is declared once" as a proxy for a working tab row — are rewritten as
  category B: render, measure, assert.

A regular expression cannot make that split; it needs reading. The rule for
the reading is one question per check: **if this check passed and the
product were broken, would it still pass?** If yes, it is a proxy and gets
rewritten.

The 61 assessments go by being replaced, one at a time — each becomes
either a B check or a line the post-deploy look reports on. Nothing about
the gate that grades them is discarded; it is simply asked fewer questions.

## Order of work

1. **B, on case 0.** A rendering check home: the harness renders the real
   push at a real viewport, a check reads the DOM. First check to write:
   *every page region has height greater than zero and its top edge is
   inside the window.* It fails today, on every page, at every size.
2. **The look, on case 2.** One worker, one ask, against a deployed `todo`.
   Prove the loop where deploy is already automatic.
3. **The spec layer.** Grouping on the first screen; dispatch per spec;
   delivery per spec.
4. **The light gate.** Drop the assessment panel once B covers what it was
   standing in for.
5. **Case 4's testless variant.**
6. **Feedback routing** — a finding lands on the ask that owns it.

## Two things already true and unfixed

- `review-3` — `inCut` appears zero times in `Run.tsx`; no card can show the
  in-cut mark.
- `review-33` — the write/intent/work/flow union is still declared in two
  files.

Both were graded green by a reviewer that never rendered a card.
