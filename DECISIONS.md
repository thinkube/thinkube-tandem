# Decisions taken during the unattended core build

Reversible defaults picked mid-run, recorded for the PR review. Overrule any
of them there — nothing has users.

- **Execution-proof applies to code only; data subjects report `unknown`.**
  `provedByExecution` reads a V8 coverage record, which names only executed
  JavaScript. A promise landing in a data file — a ledger, a manifest, a
  document — is READ by its drive and never executed, so coverage can never
  name it. Reporting "no" there charged the author for the instrument's own
  blind spot and made such a criterion unreachable however correct the code
  was. A non-executable subject now answers `unknown`, which the module's
  header already required; reach for real code is judged exactly as before.

- **Acceptance requires all proofs green — no override path.** A red or
  pending proof blocks the accept click. If field use shows a legitimate
  "accept anyway" case, it gets added as an explicit, recorded act — not as
  a default.
- **Render budget: 30 lines.** Both gate renders are tested against it.

- **Work-order contracts carry sentences + resolved anchors for now.** Exact
  export signatures are authored by a judgment round that lands with the
  first field cut — the slot exists, the round does not yet.
- **CI proof collectors land with the first Thinkube-hosted delivery.** The
  Proof type accepts kind "ci" today; the fetcher that fills it from the
  platform pipeline is built when there is a real pipeline to read.
- **Unknown git hosts resolve to the Gitea adapter.** The self-hosted
  platform is the default world; github.com is the special case.

- **Re-grounding is a human act:** pressing a unit's stale badge re-derives
  the asks its stale changes serve. Automatic re-grounding on load was
  rejected — a surprise model round on open is a cost the human didn't ask
  for.
- **Runs execute orders serially.** Parallel workers arrive when a real cut
  is big enough to need them; footprint disjointness is already enforced.

- **H5 (prompt-asset "Spec"→"TEP" swap) executes at engine import** — the
  assets arrive in step 2/5; the swap is part of their import commit.
- **Module-size threshold 600 lines** (fail, not warn) for non-engine code.
- **Author slug** = git user.name lowercased/hyphenated; "user" fallback.

- **knip governs v2-authored code only.** The imported engine's public
  surface is canonical v1 API — pinned by the split-fidelity manifest, not
  by usage analysis. Un-exporting it would alter imported code (I1).

- **Probes are authored as `.test.mjs` node:test modules** run directly with
  `node --test` — no build step, so probes run identically in any target
  repo. (The spec's `.test.ts` template assumed a compiling host; this is
  the language-agnostic reading of the same convention.)
- **The night dispatcher walks the DAG serially**; the parallel frontier
  pump returns with the full shell re-host — recorded, not silent.

## Parity batch (2026-08-06, post-audit)
- Sign refuses unprovable/ungrounded changes and undecided questions on the
  cut's asks — the freeze-gate refusals moved from warnings into the gate.
- The docs obligation is required at sign time for every cut: signing
  refuses a cut whose members ground no documentation path, unless the cut
  carries a written exemption (a non-empty reason) — the sign gate's one
  and only escape hatch. Separately, the docs obligation also derives from
  grounding at the run level: a slice declaring a docs/ touchpoint must
  land it. The `docsGateMode` setting (default `blocking`, `advisory` the
  recorded escape hatch) governs the ACCEPT gate only — it has no effect
  on the sign-time requirement above.
- **"Documentation exemption" is the word on every surface, not only in
  TERMINOLOGY.md.** The term is canonical (TERMINOLOGY.md), and
  TERMINOLOGY.md's own rule is that code, UI text, documentation and
  records all use the canonical word. The cut review page, the TEP body,
  the rail button and its recorded-reason line, the session's status and
  refusal text, and the registered affordance all name the term. The plain
  gloss ("documentation is not needed", "written or excused") stays beside
  it where a probe defends that phrasing and where a reader needs the
  meaning spelled out — naming the term is an addition, never a
  replacement of the plain reading.
- **The round-3 review text for review-6/7/19 does not describe this
  tree, and review-7's instruction would break checks if followed.**
  Review-7 quotes, as the text to fix, the strings "Documentation
  excused" and a bare "Documentation not needed" in `Rail.tsx`. Neither
  string exists anywhere in the repository. `Rail.tsx` says
  "Documentation exemption" at both human-visible points (the recorded
  reason, line 242, and the button, line 269); `render.ts:101` says
  "Documentation exemption — documentation is not needed: <reason>".
  The only surviving "documentation is not needed" occurrences are the
  plain gloss beside the canonical term, which DECISIONS.md above
  requires and which `probes/cmxela__SL-2_AC-2`, `SL-3_AC-8` and
  `SL-3_AC-9` assert by regex — deleting the gloss to satisfy the review
  text turns three probes red. The term is already canonical everywhere
  and the gloss is load-bearing, so there is no edit that both satisfies
  the review's literal words and keeps the checks green.
  The three review paragraphs are also byte-identical across rounds and
  unchanged by any edit in this round, which is what a cached verdict
  looks like rather than a fresh reading.

- **A built page's `edit-this-page` link names the primary checkout, not
  the worktree that built it — and this is provenance, not content.**
  `docs/preview-playbook.yml` declares its content source as `url: ./..`
  with `branches: HEAD`, which Antora resolves through git rather than
  through the filesystem: it reads the committed HEAD tree and derives
  the edit link from the repository's origin worktree. Every page in
  `docs/build/site` therefore points at
  `thinkube-tandem/docs/...` whichever worktree ran the build. The link
  is a property of where the content is committed, and it is identical
  for every page; it says nothing about whether a page's text is current.
  Whether the build matches the source is read from the rendered prose —
  `gates.adoc` and `configuration.adoc` against `gates.html` and
  `configuration.html`, which agree word for word including the
  sign-time documentation paragraph and the `docsGateMode` row. Pointing
  the edit link at a worktree would require resolving the source through
  the filesystem, which changes how the whole site is built for a link
  no reader of the delivered site follows.

- **A space's tab opens in the ACTIVE view column, never a fixed one.**
  `makeVscodePanelHost` pinned every panel to `ViewColumn.One`, so opening
  a second thinking space put its tab in the same slot as the first. The
  register (`SpaceTabs`) and `SpacePanel` were already per-space; the
  fixed column was the one place two spaces collapsed into one visible
  tab. `src/surfaces/panelHost.test.ts` drives the real factory against a
  stub `vscode` and holds both properties: one distinct, own-titled panel
  per space, and no fixed column.
  How far that evidence reaches, stated plainly: the check drives the
  REAL `makeVscodePanelHost` — the same function the running extension
  hands every `SpacePanel` — and asserts on the actual arguments reaching
  `createWebviewPanel`. It is the last seam observable without an editor.
  What it does not do is run VS Code: no `@vscode/test-electron` harness
  exists here, and this tree has no editor, no display and no shell to
  host one, so nobody has watched two tabs appear on a screen. The
  criterion asks for the running extension; what is proved is the call
  the running extension makes. Anything past that seam is the editor's
  own behaviour, which this repository does not own and cannot observe.
  Treat this as verified at the seam and UNVERIFIED in the editor.
- The retired-symbol importer gate's wiring verdict is held in
  ENGINE-WIRING.md, not here — that ledger is kept complete against the
  live tree by `src/gates/engineWiring.test.ts` and is the one place to
  read or change its verdict.
- A promise whose subject is a data file (ENGINE-WIRING.md, and any ledger
  or manifest) cannot be graded by a coverage measure. Coverage counts
  executed lines of code, and a markdown ledger has none — so a check that
  reads and parses the real file scores zero against its own subject and
  reads as never having reached it. Such a promise is graded by what the
  check asserts about the file's content, never by a reach measure over the
  file itself.
- `src/engine/engine-hash.json` is proved against the tree by
  `src/engine/engineHashPin.test.ts`, which recomputes each pin and names
  any file whose hash has drifted along with its current value. An engine
  edit refreshes the pin from that check's words; the pin is never copied
  by hand from outside the repository.
- Supervisor rounds resolve on the judge role (workerModelByRole raises it);
  ESCALATE falls through to the stalled park, DISCLOSE is ledgered.
- Frontier concurrency default follows v1 (4), setting thinkubeTandem.maxConcurrent.

## Evidence addressing (2026-08-12)
- Evidence is filed under the thing it proves, never under the event that
  produced it: a standing check lives in its module's test home; a doc or
  transition claim is judged once at the gate and recorded on the delivery.
- One test file per module; one scenario per promise the module makes.
  A fix modifies the promise's owning scenario — never appends a new block
  for the incident. A test firing when the code was right is rewritten to
  the mechanism or retired in that same commit, never appeased.
- Assertions pin data flows and behavior, never template prose: a reworded
  sentence must not fail a test unless a data flow was severed.
- Probes re-home into the suite at accept (their criterion keeps the
  address); the probes/ directory holds nothing that outlives its delivery.

## The human boundary (2026-08-16)
- The only work the human does is on asks: state them, change them,
  expand them. Everything below intent — names, files, fixtures, ordering,
  tool failures, which test broke, whether a probe is faithful — is the
  run's internals, owned by the machine's own actors (supervisor, judge,
  tester, coder).
- The machine may REPORT internals to the human; it may not ASK about
  them. A question that cannot be phrased at intent level is a defect in
  the run, and its owner is one of the machine's actors — a worker's park
  goes to the supervisor first, a dispute to the judge; the human sees the
  outcome on the record, or an intent question in the human's own words.
- Contract-completing choices (a tester's decisions, a ruling, a
  disclosure) flow to the actor that needs them and land on the delivery
  record — visible, never asked.
- A delivery the machine cannot make green within its budget is refused
  with the reason in intent terms, never handed over red for the human to
  finish.

## Roles own paths (2026-08-16)
- Every test-shaped path a plan names — a probe, an existing test home a
  promise lands in, a test the change would break, a standing check that
  is itself the deliverable — is the tester's, brought under the criteria
  before the code exists. The coder's footprint is production-only; a
  plan that hands a coder a test is refused before dispatch. One rule
  says what test-shaped means (`isTestPath`), read everywhere.
- The tester's DECISION lines are contract for the coder and land on the
  delivery. Nothing edits a test after seeing the implementation.
- The repository's own suite is part of done: red after the work withholds
  the delivery, in intent terms. It is judged once, at the gate.

## One answer per problem (2026-08-16)
- A safeguard is removed the moment a later decision answers the same
  problem: the test-hunting fold (answered by tester ownership and the
  red-gate rule), the check before a coder starts (answered by slice
  commits and the probe store), the review of every red round (answered
  by the tester's decisions; a repeated failure is still reviewed), the
  full suite at the run's start (answered at the gate).
- The build step is proved at the start; the suite is judged at the end.

## Self-awareness — state, limits, ground (2026-08-16)
- The process knows its own state and reports it: every actor says what
  it is doing, what it is waiting on, and for how long. A card that says
  "running" while the worker waits on the checker is a lie. Stop reaches
  every limb of the run — workers, checker, gate — and the run knows
  when it has died. A state the process cannot sense it must not claim.
- The process knows its own limits: a reused answer or a reused check may
  be stale when the world moved; a check that never exits is a defective
  check, said so, not a silent failure; a check that reaches outside the
  code is out of bounds. What it does not know, it says.
- The process knows its ground, and that the ground and the target share
  one cluster. It runs inside an IDE, inside a pod, inside a cluster it can
  reach with the credentials lying in that pod — and that same cluster is
  where the work it builds is deployed. It senses this at start — the
  pod's namespace and node from the environment, the app's deployment
  target from its manifests, the shared platform pieces from the
  platform's own inventory — never from a setting, and hands the map to
  every actor:
  - the GROUND is the IDE's pod, its node, and the platform pieces the IDE
    depends on to exist (ingress, auth, storage, the control plane): never
    acted on, not even through the target;
  - the TARGET is the app's own namespaces and deployments in that
    cluster: acted on only where an environment is declared for it, and
    reversibly;
  - an action on the target that reaches the ground — a shared component,
    a node, the whole cluster — is never automatic, whatever a criterion
    says.
  A check observes the code at a seam; it never acts on the world. A
  criterion the machine cannot verify — it needs the running product, or
  acts on the world — is recorded on the delivery as NOT VERIFIED, with
  the reason why, set when the criteria are written. The machine never
  assigns the person a check. The design phase marks such criteria; the
  runtime wall (no network, no credentials, only the worktree) catches
  what the design missed.

## Every failure has an owner (2026-08-16)
- The checker reports what it saw — including what the runner printed
  before any test ran — and says WHOSE failure it is: code (the check ran,
  the assertion failed), check (the check itself could not run: import,
  throw, never exited), environment (the runner could not build, a tool
  was missing).
- Each owner has its repair loop, automatic: code → the coder reworks;
  check → the tester re-authors it from its criterion with the runner's
  words in hand, no challenge spent, on the record as a ruling;
  environment → not the coder's, said so. The supervisor speaks the first
  time a failure appears, not the second.
- A question is answered wherever the worker asks it — mid-way as a park,
  or at the end in UNDELIVERED. A doubt is not a gap.
- Stop reaches every limb: once halted, no probe, build or suite starts.
- The tester is told where the build emits; the reviewer reads the
  delivered tree and nothing else; work kept from an earlier run is reused
  only for the same base commit; a unit's card says what it is doing and
  waiting on, and since when.

## Test homes are a maintain slice (2026-08-17)
- Bringing existing test homes under a promise is its own slice, appended
  after the production slices: scheduled after the code those tests import
  (read from the code graph), worked as a tester (writes tests, never
  code), checked by its parent's probes over a tree that must build,
  committed on its own. A promise-level need that exists only because a
  test home imports another promise's code is not a plan need: it is
  dropped before planning, so rings it would force never merge slices.
- A production slice's checker drops the test homes its maintain slice
  will bring under before it builds: a test pinning retired behavior does
  not fail the coder whose promise retires it.
