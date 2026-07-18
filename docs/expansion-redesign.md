# Expansion redesign — the thinking space as an uncertainty engine

**Status:** design approved 2026-07-18 (field-session with the maintainer); implementation staged, not started.

## 1. Thesis

A thinking space is not a document generator. It is an engine that drives the
**potential inability to fulfil the intent** down to zero. Four primitives:

- **Elements** are the SUBJECT MATTER — the concrete things the journal commits
  to building. They are the ROOT; everything else exists only in relation to them.
- **Gaps** are the UNCERTAINTY — the open unknowns each element carries.
- **Risk** is the READOUT — a derived measure of unfulfilled-intent likelihood,
  a function of the open gaps standing between an element and delivery.
- **Research** is the CLOSER — it produces grounded evidence that resolves gaps,
  and each closure drops the linked element's risk mechanically.

The space converges as gaps close and risk falls. Freeze becomes possible when
the uncertainty is genuinely gone — not when a checklist was ticked.

## 2. `expand_space` becomes a staged pipeline

Today: one flat gap-filler call proposes all sections simultaneously — so nothing
actually derives *from* the elements (they don't exist yet when constraints are
written), and there is no traceability. Replaced by a sequence, each stage feeding
the next, **each step displayed as it runs** (a hard requirement — the visible
progression is the maintainer's condition for accepting the extra worker rounds):

| Stage | Input → output | Notes |
|---|---|---|
| 1 | each journal ENTRY → **elements** | iterate entries one at a time; every element records `servesEntry` (its journal-entry group, for parking + trace) |
| 2 | elements + context digest → **constraints** | each constraint born linked to the element(s) it bounds |
| 3 | elements → **gaps** | each gap born linked to the element it makes uncertain |
| 4 | elements + constraints → **acceptance** | criteria+verification merged into one section (see §6) |
| 5 | whole space → **closing integrity gate** | dedup + orphan check + coverage; reports what it removed and found |

**Progression display:** each stage posts a status the board and chat show live
— e.g. `Deriving elements from entry 2 of 4…`, then `Constraints… Gaps…
Acceptance… Integrity check…`. Not optional.

### Derivation records its own reasoning

Every non-element item is created **with** its `requires` edge to the element(s)
it derives from. The edge IS the derivation's justification — there is no
separate optional linker round. This single rule delivers three things at once:
the **orphan check** (an item with no element edge is a defect), the **cut
closure** (selecting elements pulls their linked context through the edges), and
**traceability** (read any constraint, see the element it serves).

### Stage 5 — the closing integrity gate

- **Deduplicate** — semantic near-duplicates across the whole space (the existing
  Jaccard + tombstone wall, extended to run as a closing sweep).
- **Orphans** — every constraint / gap / acceptance item must link to ≥1 element.
  An orphan is either noise (drop it) or a signal of a MISSING element (surface it
  for the human to add). Never silently kept.
- **Coverage** — every element should carry acceptance; an element with none is
  flagged (it cannot be shown to be delivered).

## 3. Risk — narrowed, derived, explainable

**Definition:** risk scores the potential inability to fulfil the intent. Nothing
else. (Complexity — effort/intricacy — is a separate axis, unchanged.)

**Derived, not judged.** An element's risk is a pure function of its open gaps
(its own, plus those on the constraints/acceptance linked to it). Out of human
hands — ungameable. 1–3 buckets by open-gap count:

- **1** — no open gaps in reach.
- **2** — one or two open gaps.
- **3** — three or more open gaps.

(Thresholds tunable; buckets keep the badge simple.)

**Falls mechanically.** Close a gap (via research or a human decision/assumption)
→ the linked element's risk is recomputed downward the moment the gap resolves.

**Explainable (maintainer add, 2026-07-18).** Both scores carry a short rationale
text so the number is auditable:

- **risk rationale** — auto-generated, lists the open gaps driving the score
  (`Risk 3 — 3 open gaps: auditor-metadata source, log-capture sites, rendering
  library`). Regenerated on every gap change, so it shrinks as gaps close.
- **complexity rationale** — a one-line justification the deriving worker writes
  when it scores complexity.

## 4. Parking

Elements are grouped by the journal entry they serve (`servesEntry`). A group is
**parkable**: defer an entry's whole group — its elements plus their derived
constraints/gaps/acceptance — to postpone that functionality for a later TEP.
Parking is deferral at the group level; it is the natural unit for "not in this
cut." (Builds on the existing `deferItem` state.)

## 5. The cut, now correct

Selecting elements pulls their linked constraints/gaps/acceptance through the
edges — the closure that was expected when "nothing related got selected."
Freeze ships the elements, flags the pulled context (which stays live for future
cuts). No behavioural change to freeze semantics; the edges finally exist to make
the closure non-empty.

## 6. Ripples (explicit, so nothing surprises us mid-build)

1. **Section set becomes `elements · constraints · gap · acceptance`** — criteria
   and verification merge. `cutReadiness`/`impactCoverage`/`freeze` currently
   check `criteriaLinked` and `verificationLinked` separately; that collapses to a
   single `acceptanceLinked`. The claim-vs-probe split moves downstream to the
   spec (where the held-out probe is generated) — it does not belong at intent
   altitude, where it produced near-duplicate items.
2. **Risk stops being a stored human/worker eval** and becomes derived +
   explainable. The risk badge shows a computed value; "accept residual risk"
   goes away (you don't accept a derived risk — you close gaps). Complexity keeps
   its eval + acceptance + rationale.
3. **Display order** — elements render directly below the goal (falls out of the
   elements-root model; the raw-array-order bug is retired by a canonical display
   order).

## 7. Data-model deltas

- `Item.servesEntry?: number` — journal-entry group (elements only; the parking key).
- `Item.rationale?: { complexity?: string; risk?: string }` — the explainability text.
- Risk: computed (pure fn of open gaps) and cached into `evals.risk` +
  `rationale.risk` on every gap-state change; removed from the human eval inputs.
- Section kind `verification` retired; `criteria` renamed `acceptance` (migration:
  existing spaces map `criteria`+`verification` items into `acceptance`).
- `requires` edges are now created by derivation, not only the linker.

## 8. Implementation order (stage by stage, each shippable)

1. **Model** — `servesEntry`, `rationale`, derived-risk function + tests (pure,
   no UI). Section-kind migration (`acceptance`).
2. **Pipeline** — the staged expansion workers (elements-per-entry → constraints
   → gaps → acceptance), each creating its edges; replaces the flat gap-filler.
3. **Closing gate** — dedup + orphan + coverage sweep; report surfaced.
4. **Progression display** — live stage readout on board + chat.
5. **Risk enactment** — recompute-on-gap-change; explainable badge; research
   closes a gap → risk falls.
6. **Gate rework** — `acceptanceLinked`; freeze/cut-readiness against the new set.
7. **Parking** — group defer.

Each step keeps the suite green and is independently deployable.
