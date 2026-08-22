# Decisions taken during the unattended core build

Reversible defaults picked mid-run, recorded for the PR review. Overrule any
of them there — nothing has users.

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
- The retired-symbol importer gate stays unwired until grounding grows a
  `retires` declaration for symbol-deleting changes — it arms the day that
  field exists; the module is imported and tested.
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
