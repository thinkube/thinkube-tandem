# Decisions taken during the unattended core build

Reversible defaults picked mid-run, recorded for the PR review. Overrule any
of them there — nothing has users.

- **Acceptance requires all proofs green — no override path.** A red or
  pending proof blocks the accept click. If field use shows a legitimate
  "accept anyway" case, it gets added as an explicit, recorded act — not as
  a default.
- **Render budget: 30 lines.** Both gate renders are tested against it.
