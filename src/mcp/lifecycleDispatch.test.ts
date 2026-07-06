/**
 * Lifecycle & minting — handler-driven dispatch tests (SP-th4wqd).
 *
 * These exercise the REAL exported handlers through `dispatchTool` — the layer
 * the live MCP server runs — over a tmp `ThinkubeStore`, asserting the resulting
 * on-disk thinking space state (mirrors workUnitsDispatch.test.ts / projectsTools.test.ts,
 * NOT a pure helper in isolation).
 *
 * It holds two groups of tests:
 *
 *  - `retired` / `re-cut` (SP-th4wqd_SL-1): driving `move_slice(handle,
 *    "Retired", reason)` retires the slice (a terminal status DISTINCT from
 *    `Done` that records the reason), drops it off the active thinking space/frontier
 *    (`list_thinking_space`), yet keeps its `SL-{m}` claimed so the next `create_slice`
 *    is `max + 1` *counting the retired one* — and a `Retired` move with no
 *    reason throws. Driving `update_slice` with `files`/`satisfies`/`work_units`
 *    replaces exactly those frontmatter fields in place (the `SL-{m}` survives),
 *    and a re-cut whose footprint escapes the thinking space repo is refused with the
 *    SAME `sliceFilesResolveInRepo` rejection `create_slice` gives — proving the
 *    re-cut routes through the shared guard, not a copy.
 *
 *  - `mint` (SP-th4wqd_SL-2): `write_spec` with `spec` OMITTED but
 *    `implements: TEP-<n>` supplied allocates the NEXT sequential `SP-m` UNDER
 *    that TEP and returns the composite id `<tep>/<m>`; two omitted mints under
 *    the same TEP allocate SP-1 then SP-2 (sequential, monotonic — a constant
 *    stub fails), and the document lands at `teps/TEP-<n>/SP-<m>/spec.md`.
 *
 *  - `promotion` (SP-th4wqd_SL-3 / TEP-th3i18 #14): driving `write_tep` over a
 *    `{env:{thinkingSpaceRoot}, thinkingSpaces}` fixture whose thinking space root holds a PROMOTED TEP
 *    (seeded at `<product>/projects/<id>/teps/TEP-<id>.md`) updates that PROJECT
 *    COPY in place and creates NO `teps/TEP-{id}.md` duplicate on the session
 *    thinking space — the promotion-aware seam routes the bytes to the canonical home, so
 *    the thinking space can't split-brain a stale duplicate. An UNRESOLVABLE promotion
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
import { armApprovalForSlicing } from "./approvalGateTestSupport";
// The retire status token is read from the shared contract (never re-spelled as
// the bare literal), so this test and the `move_slice` wiring can never drift on
// what a retired slice's `status:` actually says (sliceLifecycle's invariant).
import { RETIRED_STATUS } from "../methodology/sliceLifecycle";

/** A fresh tmp thinking space store (its own dir, so `specs/` starts empty). */
function freshStore(): ThinkubeStore {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-lifecycle-mint-"),
  );
  return new ThinkubeStore(thinkingSpace, thinkingSpace);
}

/** Minimal HandlerContext for a `write_spec` dispatch. `promoteLocator` is
 *  injected so the (omitted) `implements:` mint path never touches a thinking space
 *  scan; with no `implements` it is never consulted. */
function ctxFor(store: ThinkubeStore) {
  return {
    env: {} as never,
    thinkingSpaces: { resolve: () => store } as never,
    promoteLocator: () => false,
  };
}

const ALLOW = () => {}; // writeGate: AI writes permitted.

// A complete 4-section spec body (so `write_spec`'s structural section gate passes).
const SPEC_BODY =
  "# Minted Spec\n\n## Acceptance Criteria\n\n- [ ] x\n\n" +
  "## Constraints\n\n- c\n\n## Design\n\nd\n\n## File Structure Plan\n\n- f\n";

/** The composite minted id (`<tep>/<spec>`) from a `write_spec` result. */
function mintedId(res: unknown): string {
  const spec = (res as { spec?: unknown }).spec;
  assert.equal(
    typeof spec,
    "string",
    "write_spec must return a string `spec` id when minting",
  );
  return String(spec);
}

/** Seed a parent TEP under `teps/TEP-<n>/tep.md` so a new spec can be placed
 *  beneath it (write_spec allocates `SP-m` UNDER an `implements:`-named TEP). */
async function seedTep(store: ThinkubeStore, tep: string): Promise<void> {
  await store.writeFile(
    store.pathForTep(tep),
    { kind: "tep", id: `TEP-${tep}`, status: "accepted" },
    `# TEP-${tep}\n`,
  );
}

test("write_spec with spec omitted allocates the next SP-m under its implements: TEP and writes teps/TEP-{n}/SP-{m}/spec.md", async () => {
  const store = freshStore();
  await seedTep(store, "1");

  const res = await dispatchTool(
    "write_spec",
    { body: SPEC_BODY, implements: "TEP-1" },
    ctxFor(store),
    ALLOW,
  );

  const id = mintedId(res);

  // First allocation under TEP-1 → composite id "1/1".
  assert.equal(
    id,
    "1/1",
    `minted id ${JSON.stringify(id)} must be the composite <tep>/<spec> "1/1"`,
  );

  // The document landed at teps/TEP-1/SP-1/spec.md on the tmp (org-less) store.
  const rel = store.pathForSpecDoc(id);
  assert.equal(rel, "teps/TEP-1/SP-1/spec.md");
  assert.ok(
    fs.existsSync(path.join(store.thinkubeDir, rel)),
    `expected the minted spec doc at ${rel}`,
  );
  const doc = await store.getFile(rel);
  assert.ok(doc, "the minted spec must be readable through the store");
});

test("write_spec allocations are sequential + monotonic across two omitted-spec calls under the same TEP (catches a constant stub)", async () => {
  const store = freshStore();
  await seedTep(store, "1");
  const ctx = ctxFor(store);

  const first = mintedId(
    await dispatchTool(
      "write_spec",
      { body: SPEC_BODY, implements: "TEP-1" },
      ctx,
      ALLOW,
    ),
  );
  const second = mintedId(
    await dispatchTool(
      "write_spec",
      { body: SPEC_BODY, implements: "TEP-1" },
      ctx,
      ALLOW,
    ),
  );

  // Two consecutive allocations under TEP-1 are SP-1 then SP-2 — sequential,
  // not a constant stub (which would reuse "1/1").
  assert.equal(first, "1/1", "the first allocation under TEP-1 must be SP-1");
  assert.equal(
    second,
    "1/2",
    "the second allocation under the same TEP must be the NEXT SP — monotonic",
  );
  assert.notEqual(
    first,
    second,
    "two consecutive allocations must differ — a constant id stub fails here",
  );
  // Both docs exist independently.
  assert.ok(
    fs.existsSync(path.join(store.thinkubeDir, store.pathForSpecDoc(first))),
  );
  assert.ok(
    fs.existsSync(path.join(store.thinkubeDir, store.pathForSpecDoc(second))),
  );
});

test("write_spec with a PROVIDED bare spec id composes it with its implements: TEP → teps/TEP-{n}/SP-{m}/spec.md (no TEP-2/SP-undefined stray)", async () => {
  const store = freshStore();
  await seedTep(store, "1");

  // The shape `/spec-prepare` passes: a bare SP number + `implements:`. Before the
  // fix this fell through to `pathForSpecDoc("2")` → `TEP-2/SP-undefined/spec.md`,
  // silently creating a stray doc instead of placing SP-2 under TEP-1.
  const res = await dispatchTool(
    "write_spec",
    { body: SPEC_BODY, implements: "TEP-1", spec: 2 },
    ctxFor(store),
    ALLOW,
  );

  // The returned id is the composite `<tep>/<spec>`, and the doc lands under TEP-1.
  assert.equal((res as { spec?: unknown }).spec, "1/2");
  assert.equal(
    (res as { relativePath?: unknown }).relativePath,
    "teps/TEP-1/SP-2/spec.md",
  );
  assert.ok(
    fs.existsSync(path.join(store.thinkubeDir, "teps/TEP-1/SP-2/spec.md")),
    "the spec doc must land at its composed TEP-1/SP-2 path",
  );
  // The pre-fix stray must NOT exist.
  assert.ok(
    !fs.existsSync(
      path.join(store.thinkubeDir, "teps/TEP-2/SP-undefined/spec.md"),
    ),
    "a bare provided id must never create a TEP-2/SP-undefined stray",
  );
});

test("write_spec accepts an already-composite provided spec id verbatim (<tep>/<spec>)", async () => {
  const store = freshStore();
  await seedTep(store, "1");
  const res = await dispatchTool(
    "write_spec",
    { body: SPEC_BODY, implements: "TEP-1", spec: "1/3" },
    ctxFor(store),
    ALLOW,
  );
  assert.equal((res as { spec?: unknown }).spec, "1/3");
  assert.equal(
    (res as { relativePath?: unknown }).relativePath,
    "teps/TEP-1/SP-3/spec.md",
  );
});

test("write_spec refuses a bare provided spec id with no implements: TEP (its TEP-<n>/SP-<m> location can't be resolved)", async () => {
  const store = freshStore();
  await assert.rejects(
    dispatchTool(
      "write_spec",
      { body: SPEC_BODY, spec: 2 },
      ctxFor(store),
      ALLOW,
    ),
    /implements: TEP-<n>/,
  );
});

// ─── retire + re-cut (SP-th4wqd_SL-1) ────────────────────────────────────────

// The spec id is the composite `<tep>/<spec>` in the org-scoped tree layout.
const SPEC = "1/1";

/**
 * A fresh tmp thinking space store seeded with a `## Acceptance Criteria`-bearing spec so
 * `create_slice`'s → Ready gate (every AC certified by an `ac_verifications`
 * entry) is satisfied — mirrors `workUnitsDispatch.test.ts`'s `seededStore`.
 */
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-lifecycle-slice-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-1", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

/** The `{spec, num}` parsed out of a `TEP-{n}_SP-{m}_SL-{k}` slice handle —
 *  `spec` is the composite `<tep>/<spec>` id. */
function parseHandle(handle: string): { spec: string; num: number } {
  const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
  assert.ok(m, `expected a slice handle, got ${JSON.stringify(handle)}`);
  return { spec: `${m![1]}/${m![2]}`, num: Number(m![3]) };
}

/** Create a slice through the dispatcher and return its handle. */
async function createSliceVia(
  store: ThinkubeStore,
  args: Record<string, unknown> = {},
): Promise<string> {
  await armApprovalForSlicing(store, SPEC);
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

/** Every card id currently on the thinking space (across all columns). */
async function thinkingSpaceCardIds(store: ThinkubeStore): Promise<string[]> {
  const thinkingSpace = (await dispatchTool(
    "list_thinking_space",
    {},
    ctxFor(store),
    ALLOW,
  )) as { columns: { cards: { id: string }[] }[] };
  return thinkingSpace.columns.flatMap((c) => c.cards.map((card) => card.id));
}

test("move_slice → Retired retires the slice (terminal, reason recorded), drops it off list_thinking_space, and reserves SL-{m} for max+1", async () => {
  const store = await seededStore();

  const first = await createSliceVia(store); // TEP-1_SP-1_SL-1
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

  // The retired slice has left the active thinking space/frontier.
  const idsAfterRetire = await thinkingSpaceCardIds(store);
  assert.ok(
    !idsAfterRetire.includes(first),
    `a retired slice must be excluded from list_thinking_space, but ${first} was present`,
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

test("update_slice re-cut replaces the design-time `contract` in place (SP-6/3 seam revision)", async () => {
  const store = await seededStore();
  const handle = await createSliceVia(store, { files: ["src/a.ts"] });

  const revised =
    "export function gate(dir: string): boolean; // armed by the approval store";
  await dispatchTool(
    "update_slice",
    { slice: handle, contract: revised },
    ctxFor(store),
    ALLOW,
  );

  const { frontmatter } = await readSlice(store, handle);
  assert.equal(
    frontmatter.contract,
    revised,
    "a contract-only re-cut must replace the slice's contract",
  );
  // Untouched fields survive the contract re-cut.
  assert.deepEqual(frontmatter.files, ["src/a.ts"]);
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
 * A `{env:{thinkingSpaceRoot}, thinkingSpaces}` fixture for the promotion-aware `write_tep`.
 *
 *  - `thinkingSpaceRoot` is a real tmp thinking space root that `discoverProjects` / `projectTeps`
 *    scan for promoted TEPs (`<product>/projects/<id>/teps/TEP-<id>.md`).
 *  - the SESSION thinking space store lives in its OWN tmp dir (not under `thinkingSpaceRoot`), so
 *    "no session-thinking space duplicate" is checked against a thinking space the project copies
 *    can never leak into — `store.pathForTep(id)` resolving on it would be the
 *    split-brain the feature exists to prevent.
 *  - `promoteLocator` is the `write_spec` `implements:` seam, never consulted by
 *    `write_tep`; pinned to a no-op for type parity with the other contexts.
 */
function promotedFixture(): {
  store: ThinkubeStore;
  thinkingSpaceRoot: string;
} {
  const thinkingSpaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-promote-root-"),
  );
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-sess-"));
  return {
    store: new ThinkubeStore(sessionDir, sessionDir),
    thinkingSpaceRoot,
  };
}

function ctxPromoted(store: ThinkubeStore, thinkingSpaceRoot: string) {
  return {
    env: { thinkingSpaceRoot } as never,
    thinkingSpaces: { resolve: () => store } as never,
    promoteLocator: () => false,
  };
}

/** Seed a promoted TEP as the nested org-tree dir
 *  `<product>/projects/<id>/teps/TEP-<tepId>/tep.md` (with a `project.yaml` so
 *  the dir reads as a real project) and return its abs path. A project uses the
 *  bare `teps/` root (no `<org>/` segment) — see `promote_tep`. */
function seedPromotedTep(
  thinkingSpaceRoot: string,
  product: string,
  projectId: string,
  tepId: string,
  body: string,
): string {
  const projDir = path.join(thinkingSpaceRoot, product, "projects", projectId);
  fs.mkdirSync(path.join(projDir, "teps", `TEP-${tepId}`), { recursive: true });
  fs.writeFileSync(
    path.join(projDir, "project.yaml"),
    `name: ${projectId}\nstate: open\ntag: ${projectId}\n`,
    "utf8",
  );
  const abs = path.join(projDir, "teps", `TEP-${tepId}`, "tep.md");
  fs.writeFileSync(
    abs,
    `---\nkind: tep\nid: TEP-${tepId}\nstatus: proposed\n---\n${body}\n`,
    "utf8",
  );
  return abs;
}

test("write_tep over a promoted TEP updates the PROJECT copy and writes NO session-thinking space duplicate", async () => {
  const { store, thinkingSpaceRoot } = promotedFixture();
  const tepId = "prom01";
  const OLD = "the stale promoted body";
  const NEW = "the fresh promoted body";
  const projectCopy = seedPromotedTep(
    thinkingSpaceRoot,
    "acme",
    "widgets",
    tepId,
    `# TEP-${tepId} — promoted\n\n${OLD}`,
  );

  const res = (await dispatchTool(
    "write_tep",
    { tep: tepId, body: `# TEP-${tepId} — promoted\n\n${NEW}` },
    ctxPromoted(store, thinkingSpaceRoot),
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

  // The write was routed to the project copy, thinking space-root-relative.
  assert.equal(
    res.relativePath,
    `acme/projects/widgets/teps/TEP-${tepId}/tep.md`,
    "write_tep must report the promoted project copy as its write target",
  );

  // The whole point: NO `teps/TEP-{id}.md` duplicate on the session thinking space.
  const sessionRel = store.pathForTep(tepId);
  assert.ok(
    !fs.existsSync(path.join(store.thinkubeDir, sessionRel)),
    `a promoted write must not create a session-thinking space duplicate at ${sessionRel}`,
  );
  assert.equal(
    await store.getFile(sessionRel),
    undefined,
    "the session thinking space must not see the promoted TEP through its store either",
  );
});

test("write_tep over an unresolvable promotion (two project homes) throws naming promote_tep", async () => {
  const { store, thinkingSpaceRoot } = promotedFixture();
  const tepId = "prom02";
  // Same TEP promoted into TWO project homes — an ambiguous canonical home.
  seedPromotedTep(thinkingSpaceRoot, "acme", "widgets", tepId, `# dup A`);
  seedPromotedTep(thinkingSpaceRoot, "acme", "gadgets", tepId, `# dup B`);

  await assert.rejects(
    () =>
      dispatchTool(
        "write_tep",
        { tep: tepId, body: "# updated\n\nbody" },
        ctxPromoted(store, thinkingSpaceRoot),
        ALLOW,
      ) as Promise<unknown>,
    /promote_tep/,
    "an unresolvable promotion must be refused with an error naming promote_tep",
  );

  // The refusal must not split-brain a third copy onto the session thinking space.
  assert.ok(
    !fs.existsSync(path.join(store.thinkubeDir, store.pathForTep(tepId))),
    "a refused promotion must not write a session-thinking space copy",
  );
});
