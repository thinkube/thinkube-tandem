# Tool-enforced slice creation: create_slice on the kanban MCP server

Slice files are currently created freehand (`Write` per the /slice skill),
so their format is only as consistent as the skill text each session
happened to load — three SP-2 cards were written in the dead merged-line
format _after_ the canonical `# title` + body shape shipped. Creation moves
behind a `create_slice` MCP tool: the server allocates the number and
serializes the canonical shape, making format a property of code instead of
a behavioural promise. Humans hand-authoring files in the editor remain
first-class (ADR-0001); this governs _agent_ creation.

## Acceptance Criteria

- [x] A `create_slice` MCP tool exists: given `spec`, `title`, `body`
      (+ optional `depends_on`, `parallel`, `priority`, `board`), it writes
      the slice file in the canonical shape (`# title` heading + detail
      body, standard frontmatter) and returns the new handle + path.
- [x] The slice **number is allocated server-side** — per-Spec, archive-aware
      (`max+1` counting archived files); callers never pick numbers.
- [x] Over-long titles (> 70 chars) are **rejected with a clear error**, not
      silently accepted or clipped.
- [x] `create_slice` refuses when the parent Spec is missing or has an empty
      `## Acceptance Criteria` — the → Ready gate enforced at creation time.
- [x] `update_slice` cannot produce a heading-less file: a new body without
      a leading `# title` line keeps the existing title (re-attached), so a
      card can never regress to the merged-line shape through the tool path.
- [x] The `/slice` skill creates slices **only** via `create_slice`; if the
      tool is absent in a session it **stops and says so** — no freehand
      `Write` fallback.
- [x] The three SP-2 slices are normalized to the canonical shape and render
      on the board with a proper short title + detail body.
- [x] Mutation gating unchanged: `create_slice` is write-gated like
      `move_slice` (navigator mode refuses it).

## Constraints

- **Dual delivery** — the server code ships via the extension build (vsix
  install), the skill text via the bundle update; verification must confirm
  **both** vehicles landed before the new flow is considered working.
- Skill fixes land only in the master (`templates/methodology-bundle/`);
  installed `.claude/skills/` copies are never hand-edited (SP-3 rule).
- Human hand-authoring of slice files in the editor stays first-class
  (ADR-0001): the renderers keep tolerating non-canonical files (clip +
  split); the tool governs agent creation, it doesn't lock the format.
- No new settings, tiers, or process — within ADR-0003's lean shape.

## Design

The server (`kanbanMcpServer.ts`) gains `create_slice`: resolve the board
per call (existing registry), verify the parent Spec exists with a
non-empty `## Acceptance Criteria` (creation-time → Ready gate), allocate
the number with the store's per-Spec archive-aware allocator, derive a slug
`uid` from the title (unique within the Spec dir), and serialize the
canonical file — frontmatter (`uid`, `parent`, `status: ready`, optional
`depends_on`/`parallel`/`priority`) + `# title` + detail body. Title > 70
chars → error naming the limit. Write-gated like every mutation.

`update_slice` gets the mirror guard the panel already has: if the incoming
body's first non-empty line is not a `#` heading, the existing title line is
re-attached above it (the input is treated as detail); a body that does
start with a heading replaces title and detail wholesale.

The `/slice` skill's step 6 swaps `Write` for one `create_slice` call per
agreed slice (the proposal/blessing flow is unchanged); its safety section
gains: kanban tools absent → stop and tell the user to start a fresh
session in the repo. SP-2's three files are normalized once via the new
`update_slice` (dogfooding the guard).

Verification: `tsc` + the stdio smoke harness exercising `create_slice`
(happy path, long-title rejection, no-AC rejection, write-gate) and
`update_slice` (heading-less body keeps title), plus one fresh `/slice`
run end-to-end after both delivery vehicles update.

## File Structure Plan

- `src/mcp/kanbanMcpServer.ts` — `create_slice` tool (gate checks, allocator,
  canonical serializer, slug uid) + `update_slice` heading guard.
- `src/store/ThinkubeStore.ts` — confirm the per-Spec archive-aware
  `nextSliceNumber()` allocator; add it only if absent.
- `templates/methodology-bundle/skills/slice/SKILL.md` — step 6 creates via
  `create_slice`; safety: stop when tools are absent.
- `templates/methodology-bundle/VERSION` + `manifest.json` — bundle bump.
- `.thinkube/specs/SP-2/SL-1.md` `SL-2.md` `SL-3.md` — one-time
  normalization to the canonical shape (via the new `update_slice`).
