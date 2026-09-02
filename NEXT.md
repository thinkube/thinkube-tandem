# The run is one graph, landed

The door is the first card and the delivery the last: each with a state,
what it is doing, and its own log, read by selecting the card like every
worker's. The pane under the graph is gone; there is one way to read a
line the run wrote. The progress line speaks by phase: preparing the tree,
building, grading, handing it over, delivered or withheld. The step panel
names the promise above the step id and reads the brief back into promise,
files with their names, and criteria. 2.0.251.

## Next on the run graph

- **An audit card's chips name the check, not its number.** "AC-1 failed"
  is a key no one read on the intent page; the chip says the criterion's
  first words, as the report does.
- **The door and the delivery cards keep a clock.** While a phase runs, its
  chip shows the elapsed time from the phase's `since`, as a worker's does,
  so a silent minute reads as time passing and not as a stall. The state
  already records `since`; only the card is missing it.

# A minted promise is judged against the sentence it serves

The "what is still missing" pass mints a promise for everything it
notices. On a fresh reading of the todo template it turned five promises
from the person's sentences into seventeen: eleven were review remarks on
the template's existing tests and conventions, none required by any
sentence, each a worker at build time and a "Not needed" press to avoid.
The prompt's rule — only gaps a sentence requires and real ripples — is
held by nothing after the prompt. A gap is kept only when a promise from
the sentences cannot hold without it; everything else the pass noticed
goes on the delivery as a finding for the person to read, never as work.

# Working out has phases, like the run

Reading the code once per repository state, and looking for what is still
missing once per set, belong to no sentence. The first shows nothing at
all: the subjects' rows are marked "waiting · 0 of 4" before the code is
read, and the page hides the activity pill while any row exists, so the
longest step of the thinking looks like nine idle rows. The second shows
as a floating pill over the group, with no place in the sequence and no
clock. The thinking is a sequence:
reading the code, deriving each sentence, looking for what is missing,
grouping. Each phase in its place with its state and elapsed time, the
sentence rows keeping their own stage under the deriving phase, and no pill
over the group.

# The end-to-end path is documented once it has been walked

When the clean run of the todo space delivers, the methodology page in
tandem's documentation records the path as it happened, step by step: an
application is deployed from a template through thinkube-control; a
thinking space is created on it; a set of asks is written in the person's
words; the machine grounds them, the person builds, the run judges, and
the delivery is accepted, which is the one act that lands the work. Each
step names the page, the press, and what the person sees. Written from the
record of that run, not from memory.

# Accept is the one act that lands work, landed

A delivery is a local branch until the person accepts it. Nothing is pushed
before that: the hand-over and a withheld gate commit and stop; a worker's
tree is sealed so its `git push` fails in git's own words before any
credential is looked for, and its brief says so once. Accept merges the
branch into the checkout's own branch, pushes that, and lets the branch go.
There is no pull request and no forge adapter: a second approval on the
forge was the same decision asked twice.

What made this urgent: the platform's build pipeline fires on a push to any
branch that touches a non-Argo file, so a worker's mid-run push built and
deployed half-finished work to the live todo app. The sensor stays as it
is: how branches and versions of a thinkube app are handled is not decided
yet, and tandem no longer pushes anything but the default branch.

# The run's own honesty, landed

- **The door refuses what did not hold.** A single-test command tried on a
  real test and failed refuses the run, naming the test and the last line.
  A missing test runner — pytest, for a Python tree — is installed once
  before the command is tried.
- **The runner is given what CI gives.** The engine's own runner carries
  the two variables the pipeline hands a test container, `ADMIN_USERNAME`
  and `ADMIN_PASSWORD`, taken from the database credentials this pod holds.
  The todo app declares, per container, how one test runs with them.
- **A worker reaches nothing.** Its environment carries no credential and
  no cluster access, and a command that names kubectl, helm, psql, ssh,
  ansible, argo or a container runtime in command position is refused with
  the reason.
- **A check that could not start judges nothing.** It is "not judged", said
  once per cause on the report, never a red against the work.
- **A part's check runs in the part's own tree.** The command the door
  proved in `frontend/` on a part-relative path is the command every check
  under `frontend/` runs, from `frontend/`. Run from the repository root
  it found no test configuration and every frontend check collected
  nothing.
- **A stalled oracle answers a changed tree.** The stall guard refuses
  another round on the state it already answered twice, and lifts when the
  tree changes, whoever changed it. Latched for the rest of the run, it
  refused the actor who had fixed the cause three times without running a
  check.

Still a platform decision: a test database with its own credentials per
app, provisioned by thinkube-control, so that CI and the runner stop
handing the admin password to a test container at all.

# Where the surface stands against the mock

The mock at https://claude.ai/code/artifact/fd45846a-343c-4ee8-8e85-20e447b82591
is the source. Landed as 2.0.240, verified by headless screenshots of the
real todo space and of a delivered fixture:

- **The strip.** Where the space is, and the one next press, decided once
  in `src/surfaces/nextAction.ts` for every state: read these N, keep
  these N, group into things, build the first, work it out, build these N,
  stop, read what came back. It moves while the machine works, from the
  press to the last subject, and says how far.
- **Understood.** Your sentences in the serif, once each, inside the things
  they became, in build order, with the marks and the folded decisions.
- **What it will do.** The work page is the thing in hand: each promise in
  your face, where it lands, its criteria as ticks with the newest verdict,
  the line that unlocks Build, and what pressing Build does. The price and
  the readiness are the chosen thing's alone (`readyPerThing.test.ts`).
  The old graph of every claim in the space is gone.
- **Live / came back.** The delivery page opens with the link, then what
  you asked for and what happened to each sentence, then what was seen
  when it was used and what was not delivered; the run's own report is
  folded under it. Accept, Not this and Run again stay at the end.
- **No tab row.** The page follows the state (`src/surfaces/pageFor.ts`):
  the box while nothing is read, your sentences once they are, what it
  will do once a thing is chosen and worked out, the run while it runs,
  what came back once it is delivered. The earlier screens are quiet links
  under the strip, "the box", "your sentences", "what it will do", "the
  run", to look back at; the next state change brings the current page
  back. Delivered, the one press is "Accept it", or "Run it again" with
  the gate's reason beside it when it cannot be accepted. 2.0.241.

- **Documentation by default.** Choosing a thing that lands no page adds
  the page as a promise the machine minted: markdown under `docs/` at the
  repository root, or an `.adoc` page in `docs/modules/ROOT/pages` with a
  line in `nav.adoc` when `docs/antora.yml` marks an Antora site, which is
  how thinkube repositories mark theirs. It informs and never withholds.
  "Not needed" on the promise takes it out, and the reason line that then
  appears is the exemption. 2.0.242.

Still open against the mock:

- The disagreement line under a criterion ("you wrote due date first —
  this settles it the other way") and striking a criterion. The criteria
  are read-only ticks today.
- The three moves under a failing criterion: ship it anyway, send it back
  with one sentence, strike the criterion.
- The run graph's words: the cards are titled by the promise already, but
  the audit and gate cards still speak in checks and slices.

# A platform ask: code-server must be upgradeable

Recorded here because nothing on the platform holds it yet. The running
code-server pod predates its own playbook: the deployment carries two
environment variables where the playbook declares three, and the links
playbook 15 injects with kubectl exec (tk_ansible, tk_ssh, tk_images) are
gone from this pod. There is no path to roll the pod that a person can run:
10_deploy from inside the pod kills itself at the pod deletion, the full
install would re-clone the repositories over uncommitted work, and
thinkube-control refuses core components.

What it needs: one action that builds or pulls the image, applies the pod
specification with the environment resolved from the token (core commit
`45aa78c` does the resolving), and rolls the pods — never cloning, never
rewriting the shared `.env`. Everything playbook 15 injects by exec moves
into the image or the pod specification. thinkube-control runs it from
outside the pod being replaced.

# First to evaluate: the session-link sweep takes the editor down

Evaluate this before anything else in this file.

## What happened

The remote extension host died on every start with a JavaScript heap out of
memory, about sixteen seconds after launch. It died with Claude Code
2.1.257, 2.1.258 and 2.1.252, with thinkube-tandem disabled and enabled,
after the 276MB transcript named at `d9c0823` was moved out of its picker
directory, after 3068 mirror links were deleted, and after code-server was
restarted. The same workspace opened in a private browser window ran
without a crash.

The trigger was the browser's saved window state: the Claude panel of the
276MB session was restored on every reload, and the extension rebuilt that
conversation in the host's heap. The state lives in the browser, not on
the server, which is why nothing changed server-side helped. Clearing site
data for the editor's origin is the fix.

The transcript move and the link deletion were done in that search and are
not the cause. The 3068 links were deleted with consent because none of
those sessions held work; the 658 real transcripts in
`~/.claude/projects/-home-thinkube-apps` are untouched, and the 276MB
transcript is at `~/.claude/archive/`. What remains true, and is the reason
this item stays first: the sweep mirrored every transcript of every launch
target into one picker directory, worker transcripts included, with no
bound, and the picker opens every file in that directory at once on each
start.

## The architecture the fix must respect

- A worker gets its context back through the Agent SDK: cwd is the worktree,
  and a repair passes `resume: session` with the worker's own id. The SDK
  reads that transcript from its native project directory, encoded from the
  worktree path. Nothing in a run reads the picker directory or any symlink.
- The links exist for one reader: the human Session History picker. The
  sweep mirrors every transcript in each "Open Claude Code Here" target
  directory, worker transcripts included, and worker sessions are the bulk
  of the pile. They were never meant for the picker.
- The launcher does not learn a session's id when it opens a panel, so today
  it cannot tell a human session from a worker's.

## The options, for the person to choose

1. Mirror only sessions the launcher started. Needs the launcher to learn
   the session id, or the engine to name worker sessions so the sweep can
   skip them. Keeps every human session in the picker.
2. Bound the sweep: the newest N transcripts across targets, none above a
   size ceiling, older links pruned. A draft with N=40 and 32MB was written
   and discarded unverified. Cost: a human session older than the newest N
   drops out of the picker; it stays resumable by id from the CLI.
3. Remove the mirror. The picker shows only sessions native to the first
   workspace folder; launcher sessions are reached by id.

Whichever is chosen, the sweep must never again be able to build a pile
the picker cannot open.

---

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

- **The session-link sweep mirrors transcripts without a size ceiling.**
  `sessionLinks.ts` symlinks every `<uuid>.jsonl` from the target project
  dirs into the picker dir — one picker dir now reaches 612MB of
  transcripts through those links. Any consumer that scans that dir whole
  (the Claude extension's picker runs in the same extension host) pays for
  every mirrored byte. The sweep should skip transcripts past a size bound,
  or the mirror needs a consumer that streams. Recorded here as the ask;
  the extension-host out-of-memory crash of 2026-09-01 was traced to the
  Claude extension loading one 276MB transcript on panel restore — the
  mirror amplifies that class of failure, it did not cause that instance.

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

---

# What 2026-09-01 added, and nothing yet does

Everything above is built. This is what came out of a day spent reading a
real space instead of reasoning about one, and it is written here because
the last analysis of this size lived in a plan file and was nearly lost.

## The architecture — one declaration, three consumers

An action is described in **four** places today: `surfaceContract.ts` (the
webview's messages and labels), `phase.ts` (which phase allows it),
`mcp/boundary.ts` (machine-may and person-only), and `extension.ts` plus
`package.json` (the VS Code commands). They must agree by somebody
remembering, and they don't: `look_at` shipped as a tool and was refused on
every call because it was missing from the boundary.

1. **One registry.** Each action declared once — who may run it, in which
   phases, its label, its refusal sentence, its handler. The webview renders
   from it, the MCP exposes from it, `extension.ts` registers from it.
2. **Products, projects and template deploys become MCP-callable.** Nine
   commands drive a tree view — `newProduct`, `newProject`, `activateProject`,
   `setContextScope`, `setProduct`, and `newAppGesture`, which calls control
   to instantiate a template into a real Gitea repository with CI. None is
   reachable from the MCP; only a person clicking a tree can do any of it.
3. **Creation writes the configuration.** `spec.deploy` and `spec.verify`
   exist and nothing writes them. From a template the platform knows the
   answer — it is an app, the push deploys it, the URL follows from the name.
   Enabling an existing repository knows nothing, so ask once, there, while
   the person is present.
4. **The declaration beats the guess.** `downstream` is the one field in
   `setup.json` that is inferred rather than proved, it is cached, and it
   decides what happens after an accept. Where a repository declares, the
   survey stands down.

## The surface

Judged from a screenshot of the real space, at 1400×900 — the first time
anyone looked at it rather than measuring it.

- **Tab 0 is 90% empty white** and says *"Nothing read yet"* directly under
  *"9 subject(s)"*. It is false, and it is what "the UI shows nothing" was.
- **The same nine sentences render twice** on the intent tab — once as asks,
  once as dark SUBJECT/CLAIMS cards — in two visual languages.
- **Five machine assumptions sit above the second ask**, so what you wrote is
  buried under what the machine decided about it.
- **No primary action anywhere.** Nothing says what to do next.
- **The navigation is duplicated** — four tabs, then the same four as grey
  text on the right.
- **A stray vertical rule at x≈1080** cuts through every page.
- **Sets show no membership and no order** — five peer chips reading
  "2 subjects · 23 promises".
- **Tabs carry a bare `data-tab`**, so nothing can address a specific tab —
  neither a check nor the look worker.
- **The navigation is linear** (0→1→2→3) and the work is a loop.

The cause is architectural: `spacePush` ships 65KB of everything the machine
knows and the page renders all of it, so every screen is a data dump with no
notion of what matters now.

**The orchestration graph is the exception and the model to learn from** — it
works because it renders ONE thing, the flow, rather than everything.

**And the check that would have caught all of it:** no surface change ships
without being looked at. A mock gets rendered and fixed a dozen times in
minutes; the real surface has been edited, measured, and shipped unseen for
days. Four minutes with a screenshot said more than three days of inference.

## The reading and the derivation

- **A kept reading cannot be redone.** A space that was read before today is
  stuck with the reading it has; there is no path back. This is why the todo
  space still shows nine subjects.
- **Re-deriving a subject appends instead of replacing**, so a second pass
  writes the same answers again. Half of the todo space's 55 promises are
  echoes, including one promise whose whole job is to deduplicate the two
  the derivation itself created.
- **"Already true" is not a state.** An ask the product already satisfies
  derives nothing, which renders exactly like a failed round and like a
  subject nobody asked about.
- **`question.askId` holds a subject id.** `node.serves` does too, and
  `sign.ts` fills a variable called `askIds` from it. One word, two facts —
  the failure WORDS.md exists to record.

## For the todo app — real asks, found by reading it

- **All 168 Spanish and Catalan strings are unaccented ASCII.** `common.yes`
  is `Si`, which means *if*. Catalan `Ultim us` means *last you*, not *last
  use*. `Cancel-lar` should be `Cancel·lar`. Five strings end in `?` or `!`
  and none opens with `¿` or `¡`.
- **`app.title` is `Web Application`** and `index.html` still says
  `K8s Dashboard Hub` — leftovers from the template it was copied from.
- And the derivation, asked to work near those files, **read the missing
  accents as house style and resolved to write more of them.** A machine
  conforming to existing wrongness is not caught by any check we have.

## The delivery must end in choices, not in a sentence

Found by asking what a person can actually DO when a criterion fails. Today:
read it, and run the whole thing again. That is the only lever, which makes
better wording worth much less than it looks — a well-worded wall is a wall.

**Three moves under the failing sentence:**

1. **Ship it anyway.** On this platform the cost of being wrong is a re-run.
   "I have read it, that is fine, deploy" should be one press. The two vetoes
   are absolute today, which was right when a mistake cost a production
   incident and is not right here.
2. **Send it back with one sentence** — *"the row has to actually disappear"*
   — straight to the worker that wrote it, resumed in its own session with
   its own context. That rung exists; the gate uses it after a red check, and
   a person cannot reach it.
3. **Say the criterion was never what you meant.** The criteria are derived,
   not written by you. Striking one is worth more than this delivery: it is a
   correction to how your sentence was read, and the next derivation should
   carry it.

### And the criteria are two things wearing one word

Measured on the nine promises re-derived today: 15 criteria, of which 12 are
readable by the person who wrote the ask and 3 leak the machine — one opens
with `GET /api/v1/tasks`, two are Given/When/Then.

Worse, two of them are the same criterion at two altitudes:

- *the task remains in the rendered list* — what must be true
- *no delete request is sent* — how we know it was not faked

They have equal standing today, so a delivery can be withheld on the second
while the first passes, and the sentence in front of the person is about an
HTTP request. That is the `surface-fix` failure exactly: withheld for a
reason nobody could judge.

The evidence must not stop vetoing — it catches the UI that lies, which is
the stub-shaped failure this method exists to prevent. It must stop being a
separate criterion. One optional field: a criterion names the criterion it is
evidence for. Then the report shows nine things that must be true rather than
fifteen, and a failure reads in the person's own terms with the mechanism as
its reason:

> **Deleting a task asks me first — not kept.** The task stayed in the list,
> but a delete request was sent anyway, so it only looks right.

**And make them readable at the source.** Not paraphrased for display — the
contract must stay exact or the thing agreed is not the thing checked.
*"the list comes back with high-priority tasks first"* is as checkable as the
version with the endpoint in front, and one of them can be read.

## The surface design is agreed in a mock, not in prose

https://claude.ai/code/artifact/fd45846a-343c-4ee8-8e85-20e447b82591

Seven states, the real nine asks, built to the webview's own CSP — no
downloaded fonts, colour from theme variables — so what is agreed is what can
ship. What it settles:

- **Your sentences are set in a serif and the machine never uses that face.**
- **The marks stay.** They are not machine vocabulary: they are feedback on
  the ask. Two of the nine come back flagged "names nothing", which is the
  signal that a sentence will derive badly, shown while it can still be
  rewritten. What goes is the LABELLING — no `SUBJECT`, no
  `CLAIMS — WHAT MUST BECOME TRUE OF IT`, and no second rendering of the same
  nine sentences as dark cards.
- **The nine-into-three collapse is shown, not asserted**, so a wrong merge
  is visible in a second.
- **The criteria are shown.** Hide the machine's filing — `SL-2#eu-1`, cut,
  TEP; show its contract. The criteria are the only thing on the page a
  person can disagree with before code exists, and the sort-order inversion
  is caught there rather than after delivery.
- **Building is a dependency graph**, not a list: the edges say what cannot
  start until what finishes, which is what the existing graph gets right.
  What it gets wrong is the words on it — `SL-2` where the promise belongs,
  "0 log lines", and **"passed" painted in the failure colour**.
- **One next action, always in the same place**, saying what will happen.

The rule for colour, stated once: **never the only carrier, and never
contradicting the word.**

## The closing-gate plan is landed

The plan "The closing gate: stop withholding on the machine's own doubt,
and stop being slow" is in the code, in these commits:

- `5cb4702` — the wiring probe informs and never vetoes; its doubt is a
  finding on the delivery page, written in the person's words.
- `6f930e8` — the gate's author reads the check that failed it, and still
  may not write one at any rung.
- `f785fe9` — the gate's reviews are asked five at a time, not one after
  another.
- `adce090` — the delivery page reads for someone who was not here: whole
  criteria, the failing assertion instead of the command.

`runAcVerifications` stays serial on purpose: in production it runs only
the runnable commands, which share one cache and one CPU allowance.
