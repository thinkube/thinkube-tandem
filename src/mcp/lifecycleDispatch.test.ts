/**
 * Lifecycle & minting — handler-driven dispatch tests (SP-th4wqd).
 *
 * These exercise the REAL exported handlers through `dispatchTool` — the layer
 * the live MCP server runs — over a tmp `ThinkubeStore`, asserting the resulting
 * on-disk board state (mirrors workUnitsDispatch.test.ts / projectsTools.test.ts,
 * NOT a pure helper in isolation).
 *
 * It holds two groups of tests:
 *
 *  - `retired` / `re-cut` (SP-th4wqd_SL-1): driving `move_slice(handle,
 *    "Retired", reason)` retires the slice (a terminal status DISTINCT from
 *    `Done` that records the reason), drops it off the active board/frontier
 *    (`list_board`), yet keeps its `SL-{m}` claimed so the next `create_slice`
 *    is `max + 1` *counting the retired one* — and a `Retired` move with no
 *    reason throws. Driving `update_slice` with `files`/`satisfies`/`work_units`
 *    replaces exactly those frontmatter fields in place (the `SL-{m}` survives),
 *    and a re-cut whose footprint escapes the board repo is refused with the
 *    SAME `sliceFilesResolveInRepo` rejection `create_slice` gives — proving the
 *    re-cut routes through the shared guard, not a copy.
 *
 *  - `mint` (SP-th4wqd_SL-2): `write_spec` with `spec` OMITTED mints a
 *    base36-epoch id via the allocator and returns it (parity with `write_tep`);
 *    the id is monotonic across two mints (a constant stub fails the monotonic
 *    assertion), and the document lands at `specs/SP-{id}/spec.md`.
 *
 *  - `promotion` (SP-th4wqd_SL-3 / TEP-th3i18 #14): driving `write_tep` over a
 *    `{env:{boardRoot}, boards}` fixture whose board root holds a PROMOTED TEP
 *    (seeded at `<product>/projects/<id>/teps/TEP-<id>.md`) updates that PROJECT
 *    COPY in place and creates NO `teps/TEP-{id}.md` duplicate on the session
 *    board — the promotion-aware seam routes the bytes to the canonical home, so
 *    the board can't split-brain a stale duplicate. An UNRESOLVABLE promotion
 *    (the same TEP owned by two projects, an ambiguous home) is refused with an
 *    error naming `promote_tep`, the tool that owns the single-home invariant —
 *    rather than guessing a copy.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";
// The retire status token is read from the shared contract (never re-spelled as
// the bare literal), so this test and the `move_slice` wiring can never drift on
// what a retired slice's `status:` actually says (sliceLifecycle's invariant).
import { RETIRED_STATUS } from "../methodology/sliceLifecycle";

/** A fresh tmp board store (its own dir, so `specs/` starts empty). */
function freshStore(): ThinkubeStore {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-lifecycle-mint-"));
  return new ThinkubeStore(board, board);
}

/** Minimal HandlerContext for a `write_spec` dispatch. `promoteLocator` is
 *  injected so the (omitted) `implements:` mint path never touches a board
 *  scan; with no `implements` it is never consulted. */
function ctxFor(store: ThinkubeStore) {
  return {
    env: {} as never,
    boards: { resolve: () => store } as never,
    promoteLocator: () => false,
  };
}

const ALLOW = () => {}; // writeGate: AI writes permitted.

/** The bare minted id from a `write_spec` result, tolerating an `SP-` prefix. */
function mintedId(res: unknown): string {
  const spec = (res as { spec?: unknown }).spec;
  assert.equal(
    typeof spec,
    "string",
    "write_spec must return a string `spec` id when minting",
  );
  return String(spec).replace(/^SP-/, "");
}

test("write_spec with spec omitted mints a base36-epoch id and writes specs/SP-{id}/spec.md", async () => {
  const store = freshStore();

  const res = await dispatchTool(
    "write_spec",
    { body: "# Minted Spec\n\n## Acceptance Criteria\n\n- [ ] x\n" },
    ctxFor(store),
    ALLOW,
  );

  const id = mintedId(res);

  // base36-epoch shape (lowercase digits, ≥6 chars — same shape nextSpecNumber
  // produces). A handler that forgot to mint (e.g. returned "undefined"/empty)
  // fails here.
  assert.match(
    id,
    /^[0-9a-z]{6,}$/,
    `minted id ${JSON.stringify(id)} must be a base36-epoch id`,
  );

  // The document landed at specs/SP-{id}/spec.md on the tmp store.
  const rel = store.pathForSpecDoc(id);
  assert.equal(rel, `specs/SP-${id}/spec.md`);
  assert.ok(
    fs.existsSync(path.join(store.thinkubeDir, rel)),
    `expected the minted spec doc at ${rel}`,
  );
  const doc = await store.getFile(rel);
  assert.ok(doc, "the minted spec must be readable through the store");
});

test("write_spec mints are monotonic across two omitted-spec calls (catches a constant stub)", async () => {
  const store = freshStore();
  const ctx = ctxFor(store);
  const body = "# A\n\n## Acceptance Criteria\n\n- [ ] x\n";

  const first = mintedId(
    await dispatchTool("write_spec", { body }, ctx, ALLOW),
  );
  const second = mintedId(
    await dispatchTool("write_spec", { body }, ctx, ALLOW),
  );

  assert.notEqual(
    first,
    second,
    "two consecutive mints must differ — a constant id stub fails here",
  );
  // base36-epoch ids are fixed-width and increasing, so monotonic ⇒ lexical >.
  assert.ok(
    second > first,
    `second mint ${second} must be monotonically after the first ${first}`,
  );
  // Both docs exist independently.
  assert.ok(
    fs.existsSync(path.join(store.thinkubeDir, store.pathForSpecDoc(first))),
  );
  assert.ok(
    fs.existsSync(path.join(store.thinkubeDir, store.pathForSpecDoc(second))),
  );
});

// ─── retire + re-cut (SP-th4wqd_SL-1) ────────────────────────────────────────

const SPEC = "demo";

/**
 * A fresh tmp board store seeded with a `## Acceptance Criteria`-bearing spec so
 * `create_slice`'s → Ready gate (every AC certified by an `ac_verifications`
 * entry) is satisfied — mirrors `workUnitsDispatch.test.ts`'s `seededStore`.
 */
async function seededStore(): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-lifecycle-slice-"));
  const store = new ThinkubeStore(board, board);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

/** The `{specNumber, sliceNumber}` parsed out of a `SP-{n}_SL-{m}` handle. */
function parseHandle(handle: string): { spec: string; num: number } {
  const m = /^SP-([^_]+)_SL-(\d+)$/.exec(handle);
  assert.ok(m, `expected a slice handle, got ${JSON.stringify(handle)}`);
  return { spec: m![1], num: Number(m![2]) };
}

/** Create a slice through the dispatcher and return its handle. */
async function createSliceVia(
  store: ThinkubeStore,
  args: Record<string, unknown> = {},
): Promise<string> {
  const res = (await dispatchTool(
    "create_slice",
    { spec: SPEC, title: "a slice", body: "detail", ...args },
    ctxFor(store),
    ALLOW,
  )) as { slice: string };
  return res.slice;
}

/** Read a slice's parsed frontmatter + raw on-disk text by handle. */
async function readSlice(
  store: ThinkubeStore,
  handle: string,
): Promise<{ frontmatter: Record<string, unknown>; raw: string }> {
  const { spec, num } = parseHandle(handle);
  const rel = store.pathForSlice(spec, num);
  const parsed = await store.getFile(rel);
  assert.ok(parsed, `expected a slice file at ${rel}`);
  return {
    frontmatter: (parsed!.frontmatter ?? {}) as Record<string, unknown>,
    raw: fs.readFileSync(path.join(store.thinkubeDir, rel), "utf8"),
  };
}

/** Every card id currently on the board (across all columns). */
async function boardCardIds(store: ThinkubeStore): Promise<string[]> {
  const board = (await dispatchTool(
    "list_board",
    {},
    ctxFor(store),
    ALLOW,
  )) as { columns: { cards: { id: string }[] }[] };
  return board.columns.flatMap((c) => c.cards.map((card) => card.id));
}

test("move_slice → Retired retires the slice (terminal, reason recorded), drops it off list_board, and reserves SL-{m} for max+1", async () => {
  const store = await seededStore();

  const first = await createSliceVia(store); // SP-demo_SL-1
  assert.equal(parseHandle(first).num, 1);

  const reason = "superseded by a cleaner re-cut approach";
  await dispatchTool(
    "move_slice",
    { slice: first, status: "Retired", reason },
    ctxFor(store),
    ALLOW,
  );

  // Terminal status is the shared `RETIRED_STATUS` token — distinct from `done`.
  const { frontmatter, raw } = await readSlice(store, first);
  assert.equal(
    frontmatter.status,
    RETIRED_STATUS,
    "a retired slice's status must be the shared RETIRED_STATUS token",
  );
  assert.notEqual(
    frontmatter.status,
    "done",
    "Retired is a terminal state DISTINCT from Done",
  );
  // The reason is recorded on disk (field-name-agnostic: the contract only
  // promises the *why* is captured, not which frontmatter key holds it).
  assert.ok(
    raw.includes(reason),
    "the retire reason must be recorded in the slice file",
  );

  // The retired slice has left the active board/frontier.
  const idsAfterRetire = await boardCardIds(store);
  assert.ok(
    !idsAfterRetire.includes(first),
    `a retired slice must be excluded from list_board, but ${first} was present`,
  );

  // Its SL-{m} stays claimed: the next slice is max+1 COUNTING the retired one,
  // so a retired number is never reused.
  const second = await createSliceVia(store);
  assert.equal(
    parseHandle(second).num,
    2,
    "the retired slice's number must stay reserved — next slice is max+1",
  );
});

test("move_slice → Retired with no reason throws (a retire must record why)", async () => {
  const store = await seededStore();
  const handle = await createSliceVia(store);

  await assert.rejects(
    () =>
      dispatchTool(
        "move_slice",
        { slice: handle, status: "Retired" }, // no reason
        ctxFor(store),
        ALLOW,
      ) as Promise<unknown>,
    /reason/i,
    "retiring without a reason must be refused",
  );

  // The refusal happens before any write — the slice is untouched (not retired).
  const { frontmatter } = await readSlice(store, handle);
  assert.notEqual(
    frontmatter.status,
    RETIRED_STATUS,
    "a refused retire must not have mutated the slice's status",
  );
});

test("update_slice re-cut replaces files/satisfies/work_units in place, preserving SL-{m}", async () => {
  const store = await seededStore();

  const handle = await createSliceVia(store, {
    files: ["src/before.ts"],
    satisfies: [1],
  });
  const { num: numBefore } = parseHandle(handle);

  const newFiles = ["src/after-a.ts", "src/after-b.ts"];
  const newSatisfies = [1];
  const newUnits = [
    { footprint: ["src/after-a.ts"], execution: "fan-out", note: "author a" },
    { footprint: ["src/after-b.ts"], execution: "fan-out", note: "author b" },
  ];

  await dispatchTool(
    "update_slice",
    {
      slice: handle,
      files: newFiles,
      satisfies: newSatisfies,
      work_units: newUnits,
    },
    ctxFor(store),
    ALLOW,
  );

  // Same handle / SL-{m} after the re-cut — the number lives in the path, not
  // the replaced footprint fields.
  const { frontmatter } = await readSlice(store, handle);
  assert.equal(
    parseHandle(handle).num,
    numBefore,
    "a re-cut keeps the slice's SL-{m}",
  );
  assert.deepEqual(
    frontmatter.files,
    newFiles,
    "re-cut must REPLACE `files` wholesale (old footprint gone)",
  );
  assert.deepEqual(frontmatter.satisfies, newSatisfies);
  const wu = frontmatter.work_units as { footprint: string[]; note?: string }[];
  assert.equal(wu?.length, 2, "re-cut must replace `work_units`");
  assert.deepEqual(wu[0].footprint, ["src/after-a.ts"]);
  assert.deepEqual(wu[1].footprint, ["src/after-b.ts"]);
});

test("update_slice re-cut whose files escape the repo is refused with the SAME guard rejection create_slice gives", async () => {
  const store = await seededStore();
  const handle = await createSliceVia(store, { files: ["src/ok.ts"] });

  const escaping = ["../outside-the-repo.ts"];

  // Capture exactly how `create_slice` refuses the same escaping footprint.
  let createError = "";
  try {
    await createSliceVia(store, { title: "escapes", files: escaping });
    assert.fail("create_slice must refuse a repo-escaping footprint");
  } catch (err) {
    createError = (err as Error).message;
  }
  assert.ok(
    createError.includes(escaping[0]),
    "create_slice's rejection must name the offending path",
  );

  // The re-cut must be refused with the IDENTICAL message — proving it routes
  // through the shared `sliceFilesResolveInRepo` guard, not a duplicated check.
  let updateError = "";
  try {
    await dispatchTool(
      "update_slice",
      { slice: handle, files: escaping },
      ctxFor(store),
      ALLOW,
    );
    assert.fail("update_slice re-cut must refuse a repo-escaping footprint");
  } catch (err) {
    updateError = (err as Error).message;
  }

  assert.equal(
    updateError,
    createError,
    "a re-cut must reuse create_slice's guard rejection verbatim, not a copy",
  );
});

// ─── promotion (SP-th4wqd_SL-3 / TEP-th3i18 #14) ─────────────────────────────

/**
 * A `{env:{boardRoot}, boards}` fixture for the promotion-aware `write_tep`.
 *
 *  - `boardRoot` is a real tmp board root that `discoverProjects` / `projectTeps`
 *    scan for promoted TEPs (`<product>/projects/<id>/teps/TEP-<id>.md`).
 *  - the SESSION board store lives in its OWN tmp dir (not under `boardRoot`), so
 *    "no session-board duplicate" is checked against a board the project copies
 *    can never leak into — `store.pathForTep(id)` resolving on it would be the
 *    split-brain the feature exists to prevent.
 *  - `promoteLocator` is the `write_spec` `implements:` seam, never consulted by
 *    `write_tep`; pinned to a no-op for type parity with the other contexts.
 */
function promotedFixture(): { store: ThinkubeStore; boardRoot: string } {
  const boardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-root-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-sess-"));
  return { store: new ThinkubeStore(sessionDir, sessionDir), boardRoot };
}

function ctxPromoted(store: ThinkubeStore, boardRoot: string) {
  return {
    env: { boardRoot } as never,
    boards: { resolve: () => store } as never,
    promoteLocator: () => false,
  };
}

/** Seed a promoted TEP under `<product>/projects/<id>/teps/TEP-<tepId>.md` (with
 *  a `project.yaml` so the dir reads as a real project) and return its abs path. */
function seedPromotedTep(
  boardRoot: string,
  product: string,
  projectId: string,
  tepId: string,
  body: string,
): string {
  const projDir = path.join(boardRoot, product, "projects", projectId);
  fs.mkdirSync(path.join(projDir, "teps"), { recursive: true });
  fs.writeFileSync(
    path.join(projDir, "project.yaml"),
    `name: ${projectId}\nstate: open\ntag: ${projectId}\n`,
    "utf8",
  );
  const abs = path.join(projDir, "teps", `TEP-${tepId}.md`);
  fs.writeFileSync(
    abs,
    `---\nkind: tep\nid: TEP-${tepId}\nstatus: proposed\n---\n${body}\n`,
    "utf8",
  );
  return abs;
}

test("write_tep over a promoted TEP updates the PROJECT copy and writes NO session-board duplicate", async () => {
  const { store, boardRoot } = promotedFixture();
  const tepId = "prom01";
  const OLD = "the stale promoted body";
  const NEW = "the fresh promoted body";
  const projectCopy = seedPromotedTep(
    boardRoot,
    "acme",
    "widgets",
    tepId,
    `# TEP-${tepId} — promoted\n\n${OLD}`,
  );

  const res = (await dispatchTool(
    "write_tep",
    { tep: tepId, body: `# TEP-${tepId} — promoted\n\n${NEW}` },
    ctxPromoted(store, boardRoot),
    ALLOW,
  )) as { tep?: string; relativePath?: string; promoted?: boolean };

  // The project copy — the canonical home everyone reads — carries the new body.
  const onDisk = fs.readFileSync(projectCopy, "utf8");
  assert.ok(
    onDisk.includes(NEW),
    "the promoted project copy must be updated with the new body",
  );
  assert.ok(
    !onDisk.includes(OLD),
    "the project copy's stale body must be replaced, not appended",
  );

  // The write was routed to the project copy, board-root-relative.
  assert.equal(
    res.relativePath,
    `acme/projects/widgets/teps/TEP-${tepId}.md`,
    "write_tep must report the promoted project copy as its write target",
  );

  // The whole point: NO `teps/TEP-{id}.md` duplicate on the session board.
  const sessionRel = store.pathForTep(tepId);
  assert.ok(
    !fs.existsSync(path.join(store.thinkubeDir, sessionRel)),
    `a promoted write must not create a session-board duplicate at ${sessionRel}`,
  );
  assert.equal(
    await store.getFile(sessionRel),
    undefined,
    "the session board must not see the promoted TEP through its store either",
  );
});

test("write_tep over an unresolvable promotion (two project homes) throws naming promote_tep", async () => {
  const { store, boardRoot } = promotedFixture();
  const tepId = "prom02";
  // Same TEP promoted into TWO project homes — an ambiguous canonical home.
  seedPromotedTep(boardRoot, "acme", "widgets", tepId, `# dup A`);
  seedPromotedTep(boardRoot, "acme", "gadgets", tepId, `# dup B`);

  await assert.rejects(
    () =>
      dispatchTool(
        "write_tep",
        { tep: tepId, body: "# updated\n\nbody" },
        ctxPromoted(store, boardRoot),
        ALLOW,
      ) as Promise<unknown>,
    /promote_tep/,
    "an unresolvable promotion must be refused with an error naming promote_tep",
  );

  // The refusal must not split-brain a third copy onto the session board.
  assert.ok(
    !fs.existsSync(path.join(store.thinkubeDir, store.pathForTep(tepId))),
    "a refused promotion must not write a session-board copy",
  );
});
