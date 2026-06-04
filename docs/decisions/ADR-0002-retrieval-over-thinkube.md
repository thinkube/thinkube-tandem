---
kind: decision
id: ADR-0002
title: Structural/lexical retrieval over .thinkube/ — no vector RAG in core
status: accepted
created: 2026-06-03
repo: thinkube/thinkube-ai-integration
---

# ADR-0002 — Retrieval over `.thinkube/`: structural/lexical, not vector RAG

## Status

Accepted — 2026-06-03. Builds on [ADR-0001](./ADR-0001-files-as-source-of-truth.md).

## Context

With `.thinkube/` as the committed source of truth (ADR-0001), the corpus of
epics/stories/specs/tasks/decisions/retros grows over time. The question arose
whether to implement RAG (embedding-based semantic retrieval) so Claude can pull
relevant context on demand.

Three facts argue against vector RAG as a core dependency:

1. **The corpus is structured and ID-addressed, not a document soup.** The
   hierarchy _is_ the index — `parent:` frontmatter links story→spec→task, and
   specs decompose into named task files. Most retrieval in the workflow (e.g.
   `/pair-start ST-42` loading that story's specs+tasks) is deterministic graph
   traversal, where embeddings add nothing. Per active context the working set is
   small and nameable.
2. **Git-native lexical search already covers the structured 80%.** ripgrep over
   a few hundred small, frontmatter-tagged markdown files is instant and yields
   exact `file:line` citations (which RAG chunking tends to lose). The `explorer`
   subagent is already a read-only retrieval step that keeps main context lean.
3. **A vector index fights ADR-0001.** It is _derived_ state. It does not survive
   `git clone` unless committed (binary churn + staleness) or rebuilt (needs an
   embedding endpoint reachable at index time + somewhere to run it). Either way
   it reintroduces the always-on service dependency we deliberately removed to be
   host-agnostic and offline-capable on Gitea.

Where semantic recall genuinely helps is a minority of the workflow, concentrated
in the _unstructured, accreting_ artifacts — **decisions** and **retros** ("have
we decided anything about X before?", "did we hit this bug shape in a past
retro?") and related-work/dedup before authoring a new spec.

## Decision

**No vector RAG in the core. Use structural + lexical retrieval, with generated
index/summary files for the accreting kinds. Keep a clean seam so a narrowly
scoped, rebuildable vector retriever can be added later if real usage shows a
semantic-recall gap.**

1. **Structural + lexical first.** A generated frontmatter index + ripgrep + the
   `explorer` subagent. Filter retrieval by `status:` so Done/stale specs don't
   pollute results — the structure carries the relevance.
2. **Index/summary files for accreting kinds.** Generated, committed files such as
   `.thinkube/decisions/INDEX.md` (and a retro index) holding one-line synopses
   Claude can scan in a single read. Poor-man's retrieval, often sufficient.
3. **A retrieval seam, not an implementation.** Keep retrieval behind a small
   interface so a vector retriever can slot in later — **scoped to decisions +
   retros (+ spec summaries) only**, **rebuilt on demand**, and **never
   committed**. Off unless explicitly enabled.

## Consequences

**Positive**

- Zero new infrastructure or service dependency; preserves the git-only,
  host-agnostic, offline posture from ADR-0001.
- Exact, citeable results; results respect `status:` so stale content is excluded.

**Negative / costs**

- Semantic recall over unstructured memory is weaker than embeddings would give —
  accepted, and mitigated by the index files + the `explorer` agent.
- If `.thinkube/` ever becomes long-lived **cross-repo** institutional memory
  queried by meaning, revisit: enable the scoped, rebuildable vector retriever
  behind the seam (decisions + retros), never committing the index.

## Alternatives considered

- **Full vector RAG over the whole tree.** Rejected: premature at current scale,
  unnecessary for the structured majority, and fights git-as-source-of-truth.
- **Commit the embedding index to git.** Rejected: binary churn and staleness,
  defeats the reinstall-via-`git clone` model.
