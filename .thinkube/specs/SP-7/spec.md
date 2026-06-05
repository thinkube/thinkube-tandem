# Conflict-free timestamp Spec IDs

Implements ADR-0008's ID decision: a Spec's identity becomes a zero-padded
base36 encoding of its creation epoch-seconds (`SP-tw7n0g`) instead of a
consecutive integer. Independent writers mint without coordination, so the
canonical-repo round-trip SP-5 added (SL-3) to keep integers unique is no longer
needed and is removed; the IDs still sort chronologically and decode back to a
time. Slices stay consecutive `SL-1..n` within their Spec, and existing
integer-numbered Specs keep working unchanged.

## Acceptance Criteria

- [x] A newly created Spec is identified by a **base36 epoch-seconds ID**
      (`SP-<id>`, e.g. `SP-tw7n0g`) that sorts chronologically and decodes to
      its creation time — not a consecutive integer.
- [x] **Two Specs created independently** (two worktrees / sessions, no shared
      counter) receive **distinct IDs** — creating a Spec no longer resolves a
      canonical repo to allocate a number (SP-5's SL-3 minting is removed).
- [x] A **single writer creating Specs back-to-back** never self-collides — IDs
      are monotonic per writer (it never reuses its own last second).
- [x] **Slices remain `SL-1..n`** within their Spec; handles stay short
      (`SP-<id>_SL-<m>`).
- [x] **Existing integer-numbered Specs keep working** — SP-1…SP-8 still read,
      address, move, and verify on the board with no migration.
- [x] The ID is **path- and handle-safe verbatim** — the `SP-<id>/` directory,
      the `SP-<id>_SL-<m>` handle, and a `spec/SP-<id>` branch all use it
      unescaped.

## Constraints

- **base36 epoch-seconds, no suffix (ADR-0008).** Cross-writer same-second
  collision is accepted (rare, benign — a visible merge conflict resolved by
  renaming); same-_writer_ collision is prevented by monotonic minting.
- **Opaque string ids, back-compat.** Existing integer-numbered Specs
  (SP-1…SP-8) keep working as string ids `"1"`…`"8"` — no migration, no rename
  (pointless churn on done work). Integers are simply a valid id subset.
- **Slices stay `SL-<integer>`** within a Spec — only the _Spec_ id changes.
- **Reuse, don't re-architect.** Type-propagate from the two linchpins
  (`nextSpecNumber`, `listSpecDirs`); route card resolution through the existing
  string handle rather than rework the webview's numeric protocol.
- **Skill/master wording fixes land in `templates/methodology-bundle/`** (SP-3).
- **Lean (ADR-0003):** no new settings; slice numbering untouched.

## Design

The change is broad but mechanical: a Spec id stops being a `number` (max+1) and
becomes an opaque `string`. Two linchpins drive it. **Minting** —
`ThinkubeStore.nextSpecNumber` (`:293`) swaps max+1 for a zero-padded base36 of
`floor(Date.now()/1000)`, returning a `string`; because the id no longer derives
from existing dirs, this also removes the only reason for SP-5's canonical-repo
round-trip (`boards.ts:197-209`), which is deleted (`onCreateSpec` collapses to
`await store.nextSpecNumber()`). **Discovery** — `listSpecDirs` (`:246`) parses
`^SP-(\d+)$` → `^SP-([A-Za-z0-9]+)$` and returns `string[]` (no numeric sort);
its consumers inherit the string type.

From there it is type propagation `specNumber: number → string`: ThinkubeStore
path helpers (`pathForSpecDoc`, `pathForSlice`, `sliceHandle`, `listSlices`,
`nextSliceNumber`); the MCP server (`SLICE_PATH_RE`/`SLICE_HANDLE_RE` digit
groups → `[A-Za-z0-9]+`, `create_slice`'s `spec` param `number`→`string`,
`parseSliceHandle`, the `reqHashBySpec` map); `sliceBoard` (`SliceInput`,
`sliceHandle`, sort → `localeCompare`); `SpecsProvider`; `ThinkubeFilesAdapter`;
and `WorktreeService`/`worktree.ts` (the `spec/SP-<id>` branch + paths are all
template-literals). Slice numbers stay integers (`SL-(\d+)`); frontmatter's
`parent` is already a string.

The one load-bearing spot is the **numeric card encoding**
(`sliceBoard.ts:60`): `cardNumberFor = specNumber*100000 + sliceNumber` cannot
pack a string id, and the host↔webview protocol carries a numeric `issueNumber`.
The card's _real_ identity is already its string handle `SP-<id>_SL-<m>` (the
card `id`). **Decision (revised during build):** make the **string handle the
card identity across the host↔webview boundary**. The three webview messages
(`update-task`/`set-due`/`open-detail`) carry that `id` instead of a number, and
the SP-chip renders from a string `parentId` — so the numeric `issueNumber` /
`cardNumberFor` / `decodeCardNumber` surrogate is **removed entirely** and the
host resolves edits by parsing the handle. This touches the webview (a rebuild is
required) but is cleaner than a hash+map. `paletteForParent` colours by a string
hash of the id. (The `StorageAdapter.updateIssue`/`setDueDate` signatures change
`number → id: string`, rippling to `Panel`, `InMemoryAdapter`, and the
`sliceBoard.test.ts`.)

**Spike:** confirm base36(epoch-seconds) is ≤ ~6 chars through ~2038 and
zero-pads to a fixed width so directory/handle lexical sort matches creation
order; pick the monotonic-minting mechanism (track last-minted second in-process,
bump +1s on a same-second repeat).

## File Structure Plan

- `src/store/ThinkubeStore.ts` — `nextSpecNumber` → base36-epoch `string`
  (monotonic); `listSpecDirs` regex + `string[]`; path/handle helpers
  `specNumber: string`.
- `src/commands/boards.ts` — `onCreateSpec`: delete the SP-5 canonical
  round-trip, mint via `store.nextSpecNumber`; `openDetail` resolves the card by
  its string handle.
- `src/mcp/kanbanMcpServer.ts` — `SLICE_PATH_RE`/`SLICE_HANDLE_RE` string groups;
  `create_slice` `spec` param `string`; `parseSliceHandle` + the per-spec maps.
- `src/views/kanban/host/storage/sliceBoard.ts` — `SliceInput.specNumber`
  `string`; `sliceHandle`; sort → `localeCompare`; `paletteForParent` string
  hash; retire spec-id packing in `cardNumberFor`/`decodeCardNumber` (surrogate).
- `src/views/kanban/host/storage/ThinkubeFilesAdapter.ts` — maps/regex/
  `refForCard` → string; resolve via handle, not `decodeCardNumber`.
- `src/views/boards/SpecsProvider.ts` — `SpecNode.specNumber` `string`; sort →
  `localeCompare`.
- `src/services/WorktreeService.ts` + `src/commands/worktree.ts` — `specNumber`
  `string`; `spec/SP-<id>` branch + paths.
- `src/store/frontmatter.ts` — verify `parent` stays `string` (no change
  expected).
- `src/views/kanban/host/types.ts` + `webview/kanban/src/types.ts` — `TaskCard`
  `parentNumber → parentId: string`, drop `issueNumber`; the three messages
  carry `id: string`.
- `src/views/kanban/host/StorageAdapter.ts` + `InMemoryAdapter.ts` +
  `Panel.ts` — `updateIssue`/`setDueDate` take `id: string`; dispatch by id.
- `webview/kanban/src/components/task/index.tsx` — send `id`; render the chip
  from `parentId`; drop the `#issueNumber` display. (Webview rebuild via
  `npm run compile`.)
- `src/views/kanban/host/storage/sliceBoard.test.ts` — update for the new shape.
- `templates/methodology-bundle/skills/{spec-prepare,slice}/SKILL.md` — drop the
  "(integer)" wording; the Spec id is opaque.
