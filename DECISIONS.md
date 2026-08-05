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
