---
uid: create-slice-canonical-server
parent: SP-4
status: done
priority: P2
verified_req_hash: 2db2bf6e1da1b39d4a3c63902ffefe45d9d7a0fe
---

# Agents can only create/edit slices in canonical shape (server)

Add the `create_slice` MCP tool — server-allocated per-Spec number
(archive-aware), slug uid, canonical `# title` + body serialization, title

> 70 chars rejected, parent Spec must exist with non-empty Acceptance
> Criteria, write-gated — plus the `update_slice` guard that re-attaches the
> existing title when a new body lacks a `#` heading. Done = the stdio smoke
> harness passes: happy path creates a canonical file; long title, AC-less
> spec, and navigator mode are refused; heading-less update keeps the title.
