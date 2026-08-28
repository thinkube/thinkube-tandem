# The process: actors, states, control points

This is the operating design. `TARGET.md` says what changes and why; this
says how the machine runs, who decides what, and what happens at each
control point when the answer is no.

## 1. Actors and their authority

| Actor | Sees | Decides | May never |
|---|---|---|---|
| **The person** | their own asks, the cut review, the delivery page | what to ask for; what a promise means; whether to sign; whether to accept | be asked about files, tools, ordering, or any internal of the run |
| **Reader** | the draft text | which sentences are asks | invent an ask |
| **Grounder** | asks, repository map, digest | which repository a promise lands in; where it lands; what proves it | write a criterion that cannot be driven; mix repositories in one promise |
| **Planner** | the signed cut, the code graph | slices, units, order, what each unit may change | give a unit a criterion whose site it may not change |
| **Tester** | criteria, contract, the repository's test homes | how each criterion is driven | read the implementation; write a check that greps source |
| **Coder** | its brief, the contract, its own files | the implementation | read or write any check; run tests itself |
| **Supervisor** | brief, checks, repository | answers a worker's question; grants a clearance | move a promise to another unit |
| **Repository gate** | the delivered tree | whether the tree stands and the promises are kept | pass a promise whose drive did not execute the code |
| **Closer** | everything, including the checks | how to finish what no other actor could | declare itself green; delete a check to pass |
| **Project gate** | every repository's delivered tree | whether cross-repository promises hold | run before the deliveries land |

## 2. States and transitions

| State | Entry condition | Exit | Refusals |
|---|---|---|---|
| `drafting` | a space exists | text is read | — |
| `read` | the reader returned asks | asks kept, or edited | a repeated ask; an empty draft |
| `understood` | promises derived and grounded | a cut is signed | see **G0** |
| `signed` | signature binds render + grounding | the run starts | see **G1** |
| `running` | the door proved the repository | every unit finished or failed | see **G2** |
| `delivered` | the repository gate ruled | accepted, rejected, or run again | see **G6** |
| `accepted` | the person accepted | merged | acceptance with a red proof |

A run is never in two states. `running` ends in exactly one of: delivered,
withheld with a report, or halted by the watchdog with a report.

## 3. Control points

Each gate states its evidence, its pass rule, and what happens on failure.
"Attends" means a person is asked — and only ever about the work.

### G0 — Grounding gate (before signing)
- **Evidence:** each promise's touchpoints, criteria, repository.
- **Passes when:** every criterion is drivable at the product's outer seam;
  every promise names exactly one repository; every criterion has a check
  site that the promise's own unit will be cleared to change.
- **Fails →** the promise returns to grounding with the reason. A criterion
  that cannot be driven anywhere is marked *unprovable* and carried to G1.
- **Attends:** no.

### G1 — Sign gate (the person)
- **Evidence:** the cut review: promises in the person's words, the
  repository each lands in, the unprovable list, open questions.
- **Passes when:** the person signs. The signature binds the rendered text
  and the grounding together.
- **Fails →** nothing is signed; editing stays open.
- **Attends:** yes — this is the designed attention point.

### G2 — Door (before any worker)
- **Evidence:** the untouched tree: install, build, one test run, where a
  source file lands.
- **Passes when:** all four are observed, on the tree as it stands.
- **Fails →** one bounded mend of a half-committed branch; then the run
  refuses with the compiler's own words. No worker is dispatched.
- **Attends:** no.

### G3 — Check-authoring gate (per slice, before any coder starts)
- **Evidence:** the checks the tester wrote, in the repository's test homes.
- **Passes when:** every criterion has a check; no check reads source text;
  no check simulates a platform the repository does not own; every import
  resolves to a path that exists or that this run will create.
- **Fails →** one authoring round with the faults named; then the slice
  fails with its reason.
- **Attends:** no.

### G4 — Unit completion
- **Evidence:** the build over the tree, and the unit's own claim.
- **Passes when:** the build is green, the unit says it is finished, and
  the unit's own criteria are green. The gate judges them again on the
  whole tree; this verdict is the unit's, and it is where the unit
  repairs itself. (The experiment in TARGET.md §6 settled this: in a
  fresh run, nine criteria went red→green inside a unit's own rounds,
  across six of nine code units. Removing the per-unit oracle would move
  those nine repairs to the gate, one round each, with the unit's context
  gone.)
- **Fails →** the unit fails with its report; its work stays in the tree and
  is named on the delivery.
- **Attends:** no.

### G5 — Slice commit
- **Evidence:** the slice's declared files and its checks.
- **Passes when:** every unit of the slice is done.
- **Fails →** the slice does not commit; its work stays in the tree and is
  named on the delivery.
- **Attends:** no.

### G6 — Repository gate (once, on the whole tree; the only judge of criteria)
- **Evidence:** the whole repository suite, every criterion's check, the
  assessments, the stub scan, the docs obligation, the execution traces.
- **Passes when:** every promise's check is green and its drive executed
  the code, and the product builds.
- **Two vetoes, and only two.** A rule may withhold only when its failure
  names an actor who can still act. By the time this gate has spent every
  rung, one actor remains — the person at Accept — so a rule that merely
  holds an opinion has no one left to route to, and holding four kept
  promises hostage to it serves nobody. What still vetoes:
  **an unkept promise** (a red check of the cut's own criteria), because
  an unkept promise must never be handed over; and **a product that does
  not build**, because handing over something that cannot ship harms
  whoever pulls it, whatever the person decides.
- **Everything else becomes a finding** and rides the delivery for the
  person to weigh at G8: a red standing suite once every actor is spent, a
  red review, a size or reachability or hygiene opinion, production that
  imitates the platform. The delivery says so on its face, in a section of
  its own; nothing is hidden and nothing is silently downgraded.
- **Fails →** each red criterion returns to the unit that owns it, **as the
  next message in that worker's own session** (resume), with the drive's
  evidence and what changed in the tree since it stopped. Then the check
  repair, then the closer with the whole tree. If a promise is still unkept
  after that, the delivery is **withheld** with every unkept promise named,
  and the way back in is offered.
- **Records:** every repair writes which stage it implicates — the author's
  own slip, a brief that lacked a fact, a check that misreads its criterion,
  a clearance that could not reach the site, or a criterion at the wrong
  altitude.
- **Attends:** only to decide accept or reject, and only on a delivery that
  passed.

### G7 — Project gate (multi-repository cuts)
- **Evidence:** every repository's delivered tree, together.
- **Passes when:** the cross-repository drives observe their promises.
- **Fails →** the promises that span repositories are named on the
  deliveries as unproven; nothing is silently accepted.
- **Attends:** no.

### G8 — Accept (the person)
- **Evidence:** the delivery page: which run produced it and when, at the
  top before any other section; what was promised, what was proven, what
  was not, the findings the machine could not settle, and where each proof
  lives.
- **Passes when:** the person accepts. The merge follows.
- **Refuses:** a delivery that was withheld, one with no proof at all, and
  one carrying a red check of the cut's own promises. A finding never
  refuses the press — weighing it is what this gate is for.
- **Fails →** reject returns the cut to `signed`; it can run again.
- **Attends:** yes — the second and last designed attention point.

## 4. Artifacts

| Artifact | Written by | Read by | Lives |
|---|---|---|---|
| asks | reader, from the person's text | grounder, briefs | the space |
| promises, criteria, repository | grounder | planner, tester, gates | the space |
| cut + signature | the person, at G1 | every actor | the space |
| slices, units, clearances | planner | scheduler, workers | the run |
| checks | tester | the oracle, the gates | the repository's test homes |
| commits | the commit book | the branch | the branch |
| run log | every actor, as it happens | the person, the next session | `<store>/runs/<tep>.log` |
| delivery record | the repository gate | the person, the ledger | the space + the forge |
| defect rows | every gate that refuses | the analysis | `<store>/defects/YYYY-MM.jsonl` — the store's root, every space in one file, each row naming its space; a space's deletion never touches it |

## 5. Measures

| Measure | Threshold | Read from |
|---|---|---|
| attention events about the machine, per run | **0** | the defect ledger: every stall, dead end, or refusal a person had to interpret |
| promises delivered with a green drive | all of them | the delivery record |
| lines written by a unit that its drive executed | **100%** | the execution trace |
| repository suite at G6 | green | the gate |
| the machine's own tests: defects caught / defects introduced | rises, never falls | the mutation run |
| unkept promises per run | falls to zero, or the run withholds | the delivery record's trajectory |
| where repairs implicate an upstream stage | shifts toward "author's own slip" | the defect ledger's new axis |

A release that raises the first measure is a bad release, whatever the test
count says.

## 6. Convergence — why the loop ends

- **Build first.** A tree that does not compile is one failure, not many. A
  deletion that breaks five imports is a build failure, never five unkept
  promises.
- **Then the count of unkept promises**, measured at round boundaries
  against the best seen so far, with patience of a couple of rounds: a
  repairer may make things temporarily worse while it does something
  structural, but not for long.
- **Bounded rungs:** author, check repair, arbiter ruling, closer — each
  once per failure, none re-entered.
- **A wall-clock backstop:** the watchdog ends a silent run with its report.
- **Three terminal states only:** delivered; withheld with every unkept
  promise named; halted with what was open.
- **Delivery only at zero.** The branch may hold any state along the way —
  there is deliberately no rule that it may never get worse, because that
  would forbid demolition. Nothing is handed over until nothing is unkept.

Guaranteed: termination, honesty, and that nothing incomplete is handed
over. Not guaranteed: that the count reaches zero. When it cannot, the run
stops and says which promise it could not keep, in your words.

## 7. Escalation policy

1. A failure is first the actor's own to fix, within its budget.
2. Then the next rung: check repair, arbiter, finisher, closer — each once,
   each paying for progress rather than attempts.
3. When every rung is spent, the unit or the delivery **fails with its
   report** — named, on the record, never silence.
4. A question reaches the person **only** if it is about the work and can be
   asked in their words. A question naming a file, a tool, or an internal is
   the machine's own failure and is answered by the machine or recorded as a
   defect.
