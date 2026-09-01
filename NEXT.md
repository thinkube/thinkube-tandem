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

### 5 · The module-size rule is reframed

Today it is `SIZE_LIMIT = 600` in `src/hygiene.test.ts` — a hard veto that
lives only in a test and is written down nowhere a person reads. It went in
after the machine produced files of five thousand lines, and it stopped
that. But it measures the wrong thing, and the cost is not theoretical: in
one afternoon four files were **compressed rather than split** to get under
it, because deleting explanation is the cheaper way to comply.

Measured against the tree it governs, it does less than it appears to:

```
imported v1 engine (exempt):  47 files · max 903 code lines · median 101
code the rule applies to:    153 files · max 493 code lines · median 110
```

Same median with or without it. It bites only at the margin, and the
largest files in the repository sit in the directory it exempts.

It also cannot see what it stands in for. `plan.ts` opens with *"execution
locks, per-slice probe and test-home maps, the closing gate's verification
list, the honesty scan, the delivery record, documentation obligations, and
the roles' invariant"* — seven things, two "and"s, 362 lines. Inside every
limit anyone proposed, and plainly a bag.

**What replaces it**, and it is the industry convention rather than a number
anyone invented: no major style guide sets a line limit. Java requires one
top-level class per file, enforced by the compiler. Go makes the *package*
the unit. Rust maps modules to files. Google's TypeScript guide asks for a
`@fileoverview` and sets no limit. ESLint's `max-lines` is off by default
and ships `skipComments` — the most-used linter concedes the same point.

> **A file holds one nameable thing, and is named after it.** Its opening
> sentence says what that is, in one sentence, without "and". A change that
> does not fit that sentence belongs in another file.
>
> The remedy, which the old rule never named: **extract a nameable piece;
> never compress the prose.**

Judged by a reviewer reading the name and the opening sentence against the
contents — cheap, because only files the change touched are read, and
exactly the kind of judgement an assessment is good at and a check is not.

**And the delivery reports the shape rather than enforcing it**: how many
source files, the largest, the median, the average lines of code, and how
much of the tree explains rather than instructs. Growth stays visible
without being punished, and what it means is the person's to judge. No
veto, no number to satisfy.

Per language, for the other targets: TypeScript and Python as above; Go
judged at the **package**, not the file; Rust at the module tree, where a
`mod.rs` re-exporting unrelated things is the bag.

## What is done

Two scorecards used to live in this file, one written mid-way and one at the
end, and they disagreed for a day. The one below "Where it stands" is the
only one now — a second copy of the same table is how a document starts
lying about itself.

Checks: 346 green. That is down from 404: ninety-six were removed as
redundant — nine ways of asserting one function's behaviour, kept two — and
the rest are new work.

### Found while doing this, and got wrong twice

`todo.thinkube.com` answers 200 and its page title is "K8s Dashboard Hub".
An earlier version of this note concluded that something other than the todo
app was serving that hostname, and named the HTTPRoute as the suspect.

That was wrong. The todo app's own `frontend/index.html` carries
`<title>K8s Dashboard Hub</title>` — a leftover from the template it was
copied from. The served page is the todo app; only its label is stale, which
is a small real defect and a fine first ask for that space.

Both times the conclusion came from reading a title and not the app's own
source, which took one grep. It is recorded here because the corrected fact
matters less than the habit that produced it.

## Where it stands

| | item | state |
|---|---|---|
| 0 | the module rule reframed | **done** |
| 1 | category B — render and measure | **done**, and it caught the layout bug |
| 2 | the look, on a deployed thing | **done** — a worker per ask, driving what was deployed |
| 3 | the spec layer | **done** — one set is the cut, the surface says which |
| 4 | the light gate | **done** — what no check can settle is exercised by the look, not listed |
| 5 | case 4 testless | **done** — the repository declares how to ask its own tool |
| 6 | feedback routing | **done** — a finding lands on the writing page, already written |
| — | `review-3` | **closed** — dead machinery removed |
| — | `review-33` | **closed** |

### What replaced the plan's own shape

The plan wrote case 4 as an Ansible sequence. That was wrong, and the
question that broke it was "what happens if it is terraform tomorrow?".
Terraform asks a different question than it applies and answers with an exit
code rather than a word in its output — so a hardcoded sequence is a branch
per tool, forever.

What replaced it is one question with the answer declared per repository:
**how is this made live**, and **how does its own tool say the work holds**.
`thinkube.yaml` grew `deploy` and `verify` blocks; `makeLive` and
`askTheTool` run the strings and know what none of them mean. Adding a tool
is a line of configuration.

That also retired a guess: the look was driving a URL assembled from the
directory name, and now uses the address the repository declares.

The spec layer needed almost nothing: dispatch, the gate and the delivery
were already per-cut. `buildFlow` took an EXCLUSION list — "one cut over
every component the human left in" — so the default was everything. It takes
one set now, and that path is deleted rather than added to.

### The test count

One removed for each added, as asked. Since the merge: **28 added, 23
removed, net +5**.

What went, and why: three checks asserting a handle "appears literally in the
webview source" (a rendering check asks better); four guarding the
READS_FILES escape (which existed to prevent a false VETO, and the probe
cannot veto now); a second copy of the 600-line rule; two source-text proxies
for behaviour tested directly; five of my own from that afternoon that read
this repository's source and matched a regex; two asserting the in-cut mark
was distinct from the state mark, once the in-cut mark was gone; and four of
a private helper, reached through an export that existed only for them.

Still +5. The next candidates are `affordances_AC-15/16` and `AC-20/21` —
two pairs, each pair two halves of one property that could be one check
each. I stopped rather than delete coverage of production behaviour nothing
else covers, which would be hitting a number instead of pruning.

## Order of work

0. **Reframe the module rule** — the cheapest item here, and it stops the
   machine paying for length by deleting explanation.
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

- **`review-33` — fixed.** `viewMove.ts` declared its own copy of the
  four-page union; it now imports `SurfacePage`. One file names the pages.

- **`review-3` — diagnosed, and it is not what the reviewer thought.** It is
  not a missing wire. `push.ts` computes `inCut: session.cutNodeIds.has(n.id)`
  on every promise, the contract carries it on `PromiseVM` — and **nothing
  reads it**. The only component with the in-cut mark is `NodeCard`, whose
  only user is `Run.tsx`, which draws run units and never has the fact. So
  the gold border, the tint and the far-zoom "cut" word are unreachable code,
  and `WorkGraph` — which draws the promises that do carry the fact — has its
  own card and never asks.

  Two honest ends, and the choice is a product decision rather than a repair:
  **remove it** (nobody asked for cut membership on a card, and rule 7 says a
  fix names what it removes), or **show it on the work graph**, where the
  fact lives and where a person looking at what is about to be built might
  want it. Forcing it onto run cards satisfies the criterion and means
  nothing: every unit in a run is in the cut, so every card would be gold.

  Left for you. What the ask behind it wanted — a second carrier at far zoom
  — is already delivered by `face`, the state word.
