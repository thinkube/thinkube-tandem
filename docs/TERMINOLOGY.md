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
| **node** | One grounded intended change: a sentence for the human, grounding underneath, edges to what it needs and the ask it serves, and the checks that will prove it. |
| **unit** | Nodes clustered by real coupling — shared touchpoints and edges, never by which ask they came from. |
| **check** | What proves a node done, bound to the node at derivation. |
| **probe** | A held-out test authored blind to the implementation; a check's executable form. |
| **cut** | A signed selection of nodes to build now. The signature binds the rendered summary and the exact grounded member list — the pair. |
| **work order** | The per-worker instruction assembled from the cut at dispatch: anchors resolved against the worker's worktree, exact signatures, the probe, the footprint, the neighbors' contracts. Assembled, never authored. |
| **footprint** | The files a worker may touch. |
| **delivery** | Branch + proof + the human's acceptance-as-merge, on whatever forge hosts the project. |
| **proof** | Evidence on a delivery: probe runs, suite verdicts, CI verdicts (image built, deploy healthy). |
| **gate** | One of the two human signatures: sign the cut, accept the delivery. |
| **abstract** | The human face of an artifact: a stamped, decision-sized render. Default view. |
| **machine face** | The artifact's data itself. Always one gesture away from its abstract. |
| **stale** | An abstract whose inputs moved since it was rendered. Computed on read, never stored. |
| **UNDELIVERED** | A worker's declared gap: what it could not do and why. |
| **affordance** | The registered human door to a machine capability — button, gesture, command. |

## Retired vocabulary

These v1 terms do not appear in v2 code, UI, or records (a suite test
enforces the unambiguous ones): **TEP**, **spec** (as an artifact),
**slice** (as an artifact), **Thinky**, **scratchpad**, **kanban**.
Their functions live on under the names above: a signed cut replaces the
TEP; work orders replace specs and slices; capture replaces Thinky.
