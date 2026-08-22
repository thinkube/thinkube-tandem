# Tandem terminology

The canonical vocabulary. Code, UI text, documentation and records all use
these words with exactly these meanings. A term not on this list is either
plain English or does not belong in the product.

| Term | Meaning |
|---|---|
| **Tandem** | The methodology: ground-truth-first pair development between a human and machine workers. |
| **Thinkube Tandem** | This extension — the tool that implements Tandem. |
| **thinking space** (or **space**) | One project's working graph and its records. |
| **ask** | The human's request, verbatim, timestamped. The machine may never rewrite an ask. |
| **grounding** | Where an intended change lands in the code: touchpoints plus a stamp. |
| **touchpoint** | One place a change lands — a structural anchor, never a line number. |
| **anchor** | A path plus an optional symbol path (`src/x.ts › reduce › case "grow"`). Line numbers are rendered from anchors at the moment of use, never stored. |
| **stamp** | A fingerprint of the repo state an artifact was true for. Machine-checkable; every artifact carries one. |
| **change** | One grounded intended change: a sentence for the human, grounding underneath, edges to what it needs and the ask it serves, and the acceptance criteria that will prove it. |
| **unit** | Nodes clustered by real coupling — shared touchpoints and edges, never by which ask they came from. |
| **acceptance criterion (AC)** | What proves a change done, bound to it at derivation; a probe is its executable form. |
| **probe** | A held-out test authored blind to the implementation; a check's executable form. |
| **cut** | The selection of changes you are shaping to build now. Signing it mints a **TEP**. |
| **TEP** | What you sign: the recorded, author-numbered commitment (`TEP-<user>-<n>`) — a Tandem Enhancement Proposal in the literal sense. Same role it always had; now a rendered record, and nothing translates it — it dispatches. |
| **slice** | A computed slice of the signed TEP — the engine's unit of validation and dispatch. Never authored. |
| **slice brief** | The per-worker instruction assembled at dispatch: anchors resolved against the worker's worktree, exact signatures, the probes, the footprint, the neighbors' contracts. Assembled, never authored. |
| **footprint** | The files a worker may touch. |
| **delivery** | Branch + proof + the human's acceptance-as-merge, on whatever forge hosts the project. |
| **proof** | Evidence on a delivery: probe runs, suite verdicts, CI verdicts (image built, deploy healthy). |
| **gate** | One of the two human signatures: sign the cut, accept the delivery. |
| **abstract** | The human face of an artifact: a stamped, decision-sized render. Default view. |
| **machine face** | The artifact's data itself. Always one gesture away from its abstract. |
| **stale** | An abstract whose inputs moved since it was rendered. Computed on read, never stored. |
| **UNDELIVERED** | A worker's declared gap: what it could not do and why. |
| **affordance** | The registered human door to a machine capability — button, gesture, command. |
| **documentation exemption** | The human's written reason that a cut needs no documentation, typed before signing and bound onto the cut by its signature. A blank reason cannot excuse a cut. |

## Retired vocabulary

Per the terminology decision records (SPEC.md Part IV): the engine's
vocabulary is the brand's — **TEP**, **slice**, **acceptance** are
canonical. Retired with their referents (suite-enforced): **Spec** (as an
artifact — the word survives only inside imported engine speech),
**Thinky**, **scratchpad**, **kanban** (as UI names), **constraint**
(→ decision), **item** (→ change), **check** (→ acceptance criterion),
**work order** (→ slice brief).
