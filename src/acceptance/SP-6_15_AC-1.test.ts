/**
 * SP-6/15 (TEP-6) AC1 — a symbol-retirement whose importers aren't all
 * footprinted is REFUSED, and the refusal names both the retired symbol and the
 * uncovered importer path(s).
 *
 * This is the reverse-dependency gate the spec adds. A slice declares — as
 * structured data, `retires: string[]` — the exported symbols it removes or
 * narrows. `create_slice` must, AFTER its existing footprint/contract-first
 * gates, scan the working repo for files that still import a retired symbol and
 * are NOT covered by the slice's footprint (its work-unit footprints ∪ `files`).
 * Any such file is a blast-radius gap the forward-scoped footprint missed
 * (exactly SP-6/11's failure: a retired export whose importers lived in files no
 * work unit owned, breaking the closing compile). The gate refuses the write and
 * names the exact re-cut the author must make — the retired symbol and each
 * uncovered importer path.
 *
 * The probe drives the REAL `create_slice` tool call (`dispatchTool` — the layer
 * the live MCP server runs), so the GATE WIRING is what's verified, against a
 * controlled temp thinking-space/repo seeded with a known importer file on disk.
 * It exercises ONLY the public tool surface named in the SPEC CONTRACT — the new
 * optional `retires` param — and makes no assumption about the internal
 * `retiredSymbolFootprint` implementation (that pure core is unit-tested
 * separately). Every assertion on the message is a SUBSTRING (never exact-glyph
 * equality) so wording can evolve; only the load-bearing facts are pinned:
 * refusal, totality (no slice file created), and the symbol + importer named.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";

// The composite spec id `<tep>/<spec>` and the tep-qualified slice-handle shape
// `create_slice` returns on success.
const SPEC = "1/1";
const SLICE_HANDLE_RE = /^TEP-1_SP-1_SL-\d+$/;

// The exported symbol the slice retires — the machine-readable successor to the
// prose `// Retired: …` contract line. Evocative of SP-6/11's own retirement
// (`APPROVAL_TTL_MS`), the failure that motivated this gate.
const RETIRED_SYMBOL = "APPROVAL_TTL_MS";

// The file the slice DOES edit (where the symbol is removed) — its footprint.
const FOOTPRINTED_SOURCE = "src/services/approvalToken.ts";

// A repo file that still imports the retired symbol via a NAMED-IMPORT specifier,
// and which the slice's footprint does NOT cover — the uncovered importer the
// gate must catch and name.
const UNCOVERED_IMPORTER = "src/consumers/usesApproval.ts";
const UNCOVERED_IMPORTER_SRC =
  `import { ${RETIRED_SYMBOL} } from "../services/approvalToken";\n` +
  `export const graceWindow = ${RETIRED_SYMBOL};\n`;

// A SECOND uncovered importer, referencing the retired symbol via a RE-EXPORT
// specifier — so the plural "importer path(s)" case (every gap named) is proven.
const UNCOVERED_REEXPORT = "src/consumers/reexportApproval.ts";
const UNCOVERED_REEXPORT_SRC = `export { ${RETIRED_SYMBOL} } from "../services/approvalToken";\n`;

/**
 * A temp thinking-space/repo whose store clears every OTHER `create_slice` gate
 * (one AC + a certified, runnable `ac_verifications` entry — mirrors the sibling
 * dispatch fixtures), so the retired-symbol gate is the only thing left to
 * decide. `thinkingSpace` doubles as the repo root (`store.workspaceRoot`), the
 * directory the gate resolves and scans for importers — the SAME resolution the
 * footprint guard uses.
 */
async function seed(): Promise<{ store: ThinkubeStore; root: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp6-15-ac1-"));
  const store = new ThinkubeStore(root, root);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-1", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return { store, root };
}

/** Write a repo-relative source file into the repo root (creating dirs). */
function seedRepoFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

// Minimal HandlerContext (mirrors the sibling dispatch tests): `create_slice`
// only touches `thinkingSpaces.resolve`. `writeGate` is a no-op so the
// allowAIWrites flag isn't in play — the retired-symbol gate is what's on trial.
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

/**
 * Invoke the real `create_slice` tool. `retires` is the new optional param from
 * the SPEC CONTRACT; `files` is the slice's footprint. A single-file slice needs
 * no `contract` (that's only required for multi-unit slices).
 */
function createSlice(
  store: ThinkubeStore,
  args: { title: string; files: string[]; retires?: string[] },
): Promise<unknown> {
  return dispatchTool(
    "create_slice",
    {
      spec: SPEC,
      title: args.title,
      body: "detail",
      files: args.files,
      ...(args.retires !== undefined ? { retires: args.retires } : {}),
    },
    ctxFor(store),
    () => {},
  );
}

// ── AC1: refusal names BOTH the retired symbol AND the uncovered importer ─────

test("AC1: create_slice REFUSES a retirement whose importer is unfootprinted, naming the symbol + importer path", async () => {
  const { store, root } = await seed();
  // A repo file already imports the retired symbol — on disk, right now (this is
  // the reverse case the gate can check statically: symbol and importer both
  // exist before orchestration).
  seedRepoFile(root, UNCOVERED_IMPORTER, UNCOVERED_IMPORTER_SRC);

  await assert.rejects(
    // The slice footprints the file it EDITS (where the symbol is removed) but
    // NOT the importer — the exact blast-radius gap this gate exists to catch.
    createSlice(store, {
      title: "retire APPROVAL_TTL_MS",
      files: [FOOTPRINTED_SOURCE],
      retires: [RETIRED_SYMBOL],
    }),
    (err: unknown) => {
      const msg = (err as Error).message;
      // The refusal must name the RETIRED SYMBOL …
      assert.match(
        msg,
        new RegExp(RETIRED_SYMBOL),
        `the refusal must name the retired symbol (got: ${msg})`,
      );
      // … AND the UNCOVERED IMPORTER'S repo-relative path — the exact re-cut the
      // author must make (add this file to a footprint, or drop the symbol).
      assert.match(
        msg,
        /src\/consumers\/usesApproval\.ts/,
        `the refusal must name the uncovered importer path (got: ${msg})`,
      );
      return true;
    },
  );

  // The refusal is TOTAL — no slice file may be created (like a footprint escape).
  assert.deepEqual(
    await store.listSlices(SPEC),
    [],
    "a refused retirement must create no slice file",
  );
});

// ── AC1: EVERY uncovered importer is named (the plural "path(s)" case) ────────

test("AC1: the refusal names EVERY uncovered importer (named-import AND re-export specifiers)", async () => {
  const { store, root } = await seed();
  seedRepoFile(root, UNCOVERED_IMPORTER, UNCOVERED_IMPORTER_SRC);
  seedRepoFile(root, UNCOVERED_REEXPORT, UNCOVERED_REEXPORT_SRC);

  await assert.rejects(
    createSlice(store, {
      title: "retire APPROVAL_TTL_MS (two importers)",
      files: [FOOTPRINTED_SOURCE],
      retires: [RETIRED_SYMBOL],
    }),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.match(msg, new RegExp(RETIRED_SYMBOL));
      assert.match(
        msg,
        /src\/consumers\/usesApproval\.ts/,
        `both uncovered importers must be named — missing the named-import one (got: ${msg})`,
      );
      assert.match(
        msg,
        /src\/consumers\/reexportApproval\.ts/,
        `both uncovered importers must be named — missing the re-export one (got: ${msg})`,
      );
      return true;
    },
  );

  assert.deepEqual(
    await store.listSlices(SPEC),
    [],
    "a refused retirement must create no slice file",
  );
});

// ── AC1 attribution control: the SAME fixture WITHOUT a `retires` declaration
// is accepted — so the refusal above is attributable to the retirement gate, not
// to anything in the scaffolding. (The full no-retirement/precision story is
// AC3's; here it only isolates the gate as the cause.) ────────────────────────

test("AC1 control: the same slice with NO retires declaration is accepted — the refusal is the gate's, not the fixture's", async () => {
  const { store, root } = await seed();
  // Identical importer on disk; identical footprint. The ONLY difference from the
  // refusal case is the absence of a `retires` declaration.
  seedRepoFile(root, UNCOVERED_IMPORTER, UNCOVERED_IMPORTER_SRC);

  const res = (await createSlice(store, {
    title: "edit approvalToken (no retirement)",
    files: [FOOTPRINTED_SOURCE],
    // retires omitted → the check short-circuits, the write proceeds as today.
  })) as { slice: string };

  assert.match(
    res.slice,
    SLICE_HANDLE_RE,
    "with no retired symbols declared, create_slice must behave exactly as today",
  );
  assert.equal(
    (await store.listSlices(SPEC)).length,
    1,
    "the accepted slice file must exist — proving the fixture is otherwise valid",
  );
});
