/**
 * SP-6/15 (TEP-6) AC4 — the declared retired-symbol set is PERSISTED as
 * structured slice frontmatter and SURFACED on slice reads.
 *
 * The gate SP-6/15 adds (AC1–AC3) is only useful if the retirement declaration
 * survives as machine-readable data a worker/orchestrator can consume — not as
 * prose buried in the contract. This AC pins that: a slice authored with the new
 * optional `retires: string[]` param round-trips through `create_slice` /
 * `update_slice` into the slice file's structured frontmatter and comes back out
 * of `get_slice` as the SAME array of symbol tokens — the machine-readable
 * successor to the old prose `// Retired: …` contract line.
 *
 * The probe drives the REAL tool surface end to end (`dispatchTool` — the layer
 * the live MCP server runs): `create_slice`/`update_slice` write, `get_slice`
 * reads back from disk. It exercises ONLY the public interface named in the SPEC
 * CONTRACT — the new optional `retires` param and `get_slice`'s `frontmatter` —
 * and makes no assumption about the internal `retiredSymbolFootprint` core (that
 * pure module is unit-tested separately) nor about the on-disk YAML shape beyond
 * "it comes back through `get_slice.frontmatter.retires`".
 *
 * The round-trip is proven with a NON-EMPTY retirement whose importers are all
 * (trivially) covered — no repo file on disk imports the retired symbols — so the
 * AC1–AC3 gate short-circuits to "no violations" and the write proceeds, leaving
 * this test to assert persistence/surfacing ALONE (the gate's refusal behaviour
 * is the other three probes' job).
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";
import { armApprovalForSlicing } from "../mcp/approvalGateTestSupport";

// The composite spec id `<tep>/<spec>` and the tep-qualified slice-handle shape
// `create_slice` returns on success (and `get_slice` reads).
const SPEC = "1/1";
const SLICE_HANDLE_RE = /^TEP-1_SP-1_SL-\d+$/;

// A multi-token retirement set — a plain exported symbol, plus two dotted
// narrowing tokens (a param of an export becoming stricter), mirroring the SPEC
// CONTRACT's own example `["APPROVAL_TTL_MS", "verifyApproval.now", "verifyApproval.ttlMs"]`.
// Treated as OPAQUE symbol tokens; the point here is that EVERY token, in ORDER,
// survives the round-trip verbatim.
const RETIRED_SET = [
  "APPROVAL_TTL_MS",
  "verifyApproval.now",
  "verifyApproval.ttlMs",
];

// The file the slice edits — a footprint that touches no importer of the retired
// set (there are none on disk), so the AC1–AC3 gate short-circuits and the write
// proceeds; this probe is about persistence, not the refusal.
const FOOTPRINT = "src/services/approvalToken.ts";

/**
 * A temp thinking-space/repo whose store clears every OTHER `create_slice` gate
 * (one AC + a certified, runnable `ac_verifications` entry — the sibling dispatch
 * fixture), so nothing but the retirement gate stands between the call and a
 * written slice. `thinkingSpace` doubles as the repo root (`store.workspaceRoot`),
 * the directory the retirement gate scans for importers (none are seeded here).
 */
async function seed(): Promise<{ store: ThinkubeStore; root: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp6-15-ac4-"));
  const store = new ThinkubeStore(root, root);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-1", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return { store, root };
}

// Minimal HandlerContext (mirrors the sibling dispatch tests): these tools only
// touch `thinkingSpaces.resolve`. `writeGate` is a no-op so `allowAIWrites` isn't
// in play — the round-trip is what's on trial.
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

/** Invoke the real `create_slice` tool with the new optional `retires` param. */
async function createSlice(
  store: ThinkubeStore,
  args: { title: string; files: string[]; retires?: string[] },
): Promise<unknown> {
  await armApprovalForSlicing(store, SPEC);
  return dispatchTool(
    "create_slice",
    {
      spec: SPEC,
      title: args.title,
      body: "detail body — the retirement lives in structured frontmatter, not here",
      files: args.files,
      ...(args.retires !== undefined ? { retires: args.retires } : {}),
    },
    ctxFor(store),
    () => {},
  );
}

/** Invoke the real `update_slice` re-cut tool (retires is the new optional param). */
function updateSlice(
  store: ThinkubeStore,
  handle: string,
  args: { body?: string; files?: string[]; retires?: string[] },
): Promise<unknown> {
  return dispatchTool(
    "update_slice",
    {
      slice: handle,
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.files !== undefined ? { files: args.files } : {}),
      ...(args.retires !== undefined ? { retires: args.retires } : {}),
    },
    ctxFor(store),
    () => {},
  );
}

/** Read a slice back through the real `get_slice` tool → its `frontmatter`/`body`. */
async function getSlice(
  store: ThinkubeStore,
  handle: string,
): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
  const res = (await dispatchTool(
    "get_slice",
    { slice: handle },
    ctxFor(store),
    () => {},
  )) as { frontmatter: Record<string, unknown>; body: string };
  return res;
}

// ── AC4: a declared `retires` set round-trips into structured frontmatter ─────

test("AC4: create_slice persists the declared retires set, and get_slice returns it verbatim (order + every token)", async () => {
  const { store } = await seed();

  const created = (await createSlice(store, {
    title: "retire the approval time surface",
    files: [FOOTPRINT],
    retires: RETIRED_SET,
  })) as { slice: string };
  assert.match(
    created.slice,
    SLICE_HANDLE_RE,
    "the slice must be created — a non-empty retirement with no uncovered importer is accepted",
  );

  // The whole set comes back through get_slice's `frontmatter.retires`, byte-for-
  // byte and in the SAME order — the machine-readable data a worker consumes.
  const { frontmatter } = await getSlice(store, created.slice);
  assert.deepEqual(
    frontmatter.retires,
    RETIRED_SET,
    "get_slice must surface the exact declared retired-symbol set (order + every token preserved)",
  );
});

test("AC4: the surfaced retires set is STRUCTURED data (an array of string tokens), not prose", async () => {
  const { store } = await seed();
  // Author-supplied title + body carry NONE of the retired tokens on purpose: the
  // `!body.includes(tok)` assertion below is meant to catch the IMPLEMENTATION
  // dumping the retirement into the markdown body — so any token found in the body
  // is the server's doing, never the author's. (An earlier revision put a token in
  // the title, which `get_slice` returns as part of `body` via the `# title`
  // heading, making the assertion trip on the author's own prose, not the impl.)
  const created = (await createSlice(store, {
    title: "retire the approval time surface",
    files: [FOOTPRINT],
    retires: RETIRED_SET,
  })) as { slice: string };

  const { frontmatter, body } = await getSlice(store, created.slice);

  // Structured: a real array whose every element is a string token — consumable
  // as data, not a free-text blob.
  assert.ok(
    Array.isArray(frontmatter.retires),
    "retires must be surfaced as a structured array, not a string",
  );
  const retires = frontmatter.retires as unknown[];
  assert.equal(
    retires.length,
    RETIRED_SET.length,
    "every declared token must be present",
  );
  for (const tok of retires) {
    assert.equal(
      typeof tok,
      "string",
      `each retired-symbol token must be a plain string (got ${typeof tok})`,
    );
  }

  // …and it lives in FRONTMATTER, not the markdown body: `get_slice` parses the
  // frontmatter block off the body, so a token appearing under `frontmatter` came
  // from structured frontmatter — and the body carries none of the tokens.
  for (const tok of RETIRED_SET) {
    assert.ok(
      !body.includes(tok),
      `the retired token "${tok}" must be structured frontmatter, not prose in the body`,
    );
  }
});

// ── AC4 backward-compat: a slice with NO retirement carries no `retires` key ──

test("AC4: a slice created with no retires declaration surfaces no `retires` frontmatter (the field is optional/absent)", async () => {
  const { store } = await seed();
  const created = (await createSlice(store, {
    title: "an ordinary slice, no retirement",
    files: [FOOTPRINT],
    // retires omitted entirely
  })) as { slice: string };

  const { frontmatter } = await getSlice(store, created.slice);
  assert.equal(
    frontmatter.retires,
    undefined,
    "with no retirement declared, the slice must carry no `retires` frontmatter — the field is optional and absent on every non-retiring slice",
  );
});

// ── AC4: the update_slice re-cut path round-trips retires too ─────────────────

test("AC4: update_slice re-cuts the retires set, and get_slice surfaces the REPLACED set", async () => {
  const { store } = await seed();

  // Author it with one retirement…
  const created = (await createSlice(store, {
    title: "retire, then re-cut",
    files: [FOOTPRINT],
    retires: ["APPROVAL_TTL_MS"],
  })) as { slice: string };
  assert.deepEqual(
    (await getSlice(store, created.slice)).frontmatter.retires,
    ["APPROVAL_TTL_MS"],
    "precondition: the initial retirement is on file",
  );

  // …then re-cut it to a DIFFERENT set through update_slice (provided → replaces
  // wholesale, mirroring the sibling files/work_units re-cut fields).
  const recut = ["verifyApproval.now", "verifyApproval.ttlMs"];
  await updateSlice(store, created.slice, { retires: recut });
  assert.deepEqual(
    (await getSlice(store, created.slice)).frontmatter.retires,
    recut,
    "update_slice must serialize the re-cut retires set, and get_slice must surface the replacement",
  );
});

test("AC4: an update_slice that omits retires leaves the existing retirement untouched", async () => {
  const { store } = await seed();
  const created = (await createSlice(store, {
    title: "retirement survives an unrelated update",
    files: [FOOTPRINT],
    retires: RETIRED_SET,
  })) as { slice: string };

  // A body-only update names no `retires` — the re-cut convention (an omitted
  // field is left untouched) must preserve the declared retirement.
  await updateSlice(store, created.slice, {
    body: "# retirement survives an unrelated update\n\nrevised detail",
  });

  assert.deepEqual(
    (await getSlice(store, created.slice)).frontmatter.retires,
    RETIRED_SET,
    "omitting `retires` on an update must leave the persisted set intact — the field is left untouched, not cleared",
  );
});
