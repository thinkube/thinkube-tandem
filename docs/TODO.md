# The work, derived from the design — and its order

Not written from memory: every item below comes from a gate in
`PROCESS.md`, a rule in `RULES.md`, a drive in `ACCEPTANCE.md`, or a defect
found in the field and recorded here. If something is missing from this
list it is missing from the design, and that is the bug to fix first.

`done` · `doing` · `todo` — and nothing below an unfinished item in the
same phase starts before it.

---

## Phase 0 — the ground must be safe to run on

| # | Work | Proof | State |
|---|---|---|---|
| 0.1 | Re-homing off: a run's checks stay evidence, never installed into the repository's suite | a run delivers and the repository holds no new test file | done |
| 0.2 | Checks do not ride the merge: a delivery does not add `probes/` to the project | after a delivery, the merged tree holds no probe | done |
| 0.3 | Headless run survives this pod: link the existing `node_modules` instead of installing | driven: the door borrows and never runs the install | done |
| 0.4 | Every run is bounded by wall clock, not only by silence | a run past its bound ends with a report | done |
| 0.5 | The headless entry uses the same scope planner as the editor | it refuses a mixed-scope promise identically, and names the repositories it cannot reach | done |

## Phase 1 — decide A, then collapse the trees

| # | Work | Proof | State |
|---|---|---|---|
| 1.1 | The experiment: how many criteria go red→green inside a unit's own rounds | **nine**, across six of nine code units, in the run of 22 Aug 12:10 | done |
| 1.2 | Delete the tester snapshot; the tester writes in the one tree | after a run no `-tester` tree exists | done |
| 1.3 | Blinding by permission: a code worker reading a check path is refused | the refusal, driven | done |
| 1.4 | Delete the probe store (persist/restore) | a resumed run still finds its checks | done |
| 1.5 | Delete the emit map | checks import what exists, with no path mapping | done |
| 1.6 | A does not hold — the per-unit oracle stays. G4 in PROCESS.md is stale and says the opposite | the number in 1.1 | done |
| 1.7 | Setup facts (install, build, one test) belong to the repository, not the editor's cache | a headless run needs no `--provision` flag | todo |

## Phase 2 — checks where they belong

| # | Work | Proof | State |
|---|---|---|---|
| 2.1 | Checks are born in the repository's own test homes and idiom | after a run, no `probes/` directory | done |
| 2.2 | A check drives the product at its outer seam; a source-text check is refused at authoring | a grep-shaped check is rejected before any coder starts | done |
| 2.3 | A check that drives nothing this cut builds is refused. *Altitude — a criterion provable only by calling a class — is refused at grounding (3.1), not here: a check follows the criterion it was written from, so refusing it at authoring punishes the wrong actor* | same gate, driven | done |

## Phase 3 — refuse the impossible before dispatch

| # | Work | Proof | State |
|---|---|---|---|
| 3.1 | A criterion provable only by calling a class is refused at grounding | refused with the promise named, before signing | todo |
| 3.2 | A criterion whose site is outside its unit's clearance is refused | SL-7's class made unrepresentable | done |
| 3.3 | A promise landing in two repositories is refused before dispatch | driven | done |
| 3.4 | The cut review shows which repository each promise lands in | visible before signing | todo |
| 3.5 | What cannot be driven is declared *unprovable* at signing, in the person's words | the list appears on the cut review | todo |
| 3.6 | Slice order puts a thin end-to-end path first | the ordering exists and is driven (`skeletonFirst`), but **nothing supplies the product's outer seam yet**, so it is not wired: a walking skeleton is a decision about how a cut is sliced, not a reordering of slices already cut | doing |

## Phase 4 — the gate, and how repair works

| # | Work | Proof | State |
|---|---|---|---|
| 4.1 | Wiring proven by execution: the drive must execute the unit's lines | the SL-6 fixture is rejected | done |
| 4.2 | A red criterion returns to its author's own session (resume), with the evidence and what changed | the repair is the next message in that session | done |
| 4.3 | Every repair records which stage it implicates (author, brief, check, clearance, altitude) | the ledger's new axis, per run | done |
| 4.4 | Convergence: build first, then unkept promises with patience against the best seen | driven: an unbuildable tree scores one, a worsening repair finishes, a stuck one ends | done |
| 4.5 | Demolition is not punished: a deletion that breaks imports for a round may continue | driven through the real closer | done |
| 4.6 | A delivery opens only when nothing is unkept; otherwise withheld, named per promise | a red proof never opens a delivery | done |
| 4.7 | Reject: a delivery the person refuses returns the cut to `signed` | the button exists and the state moves | done |
| 4.8 | One delivery record per cut, replaced per run | the space holds one row per cut, not four | done |

## Phase 5 — multi-repository

| # | Work | Proof | State |
|---|---|---|---|
| 5.1 | A project gate runs the cross-repository drives after the deliveries land | a promise spanning two repositories is proven or named unproven | todo |
| 5.2 | Until 5.1 exists, a cross-repository promise is declared unprovable at signing | visible on the cut review | todo |

## Phase 6 — the machine's own hygiene

| # | Work | Proof | State |
|---|---|---|---|
| 6.1 | Decide the 58 unused exports and 5 unused files: wire, retire, or fold | the list is empty or every entry has a verdict | todo |
| 6.2 | Reachability gate back on, with the product's real entry points | it passes, and fails when dead code returns | todo |
| 6.3 | The invariants, as tests: a run always ends (done — `ends.test.ts`); a unit is never failed for what it cannot reach; nothing written is lost from the branch | three drives | doing |
| 6.4 | A stalled run says so and stops | done — watchdog and run log | done |
| 6.5 | A unit is judged only by its own criteria | done | done |

## Phase 7 — the acceptance

| # | Work | Proof | State |
|---|---|---|---|
| 7.1 | The machine delivers the four asks, headless, three times | the delivered change runs and does what was asked | todo |
| 7.2 | Attention events about the machine, counted per run | zero | todo |
| 7.3 | If 7.1 fails twice for reasons in the machine: stop, and fall back to v1's loop plus one attention-reducing mechanism at a time | the decision, recorded here | todo |

---

**Done so far:** 0.1, 0.2, 0.3, 0.4, 0.5, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 6.4, 6.5, the headless entry (0.3 to
0.5 remain), the 796 tests deleted and five written by the rule.

**Not started:** everything in phases 1 through 5, which is the plan itself.
