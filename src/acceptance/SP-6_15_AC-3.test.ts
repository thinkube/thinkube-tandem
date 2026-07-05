/**
 * SP-6/15 (TEP-6) AC3 — Precision / no false positives, and the no-retirement
 * path is byte-for-byte unchanged.
 *
 * The reverse-dependency gate this Spec adds must be a footprint-completeness
 * BACKSTOP, not a type checker that over-claims. This probe pins the two halves
 * of AC3 the gate could get wrong in opposite directions:
 *
 *   1. PRECISION (no false positive). A retired symbol name that appears in a
 *      repo file ONLY as an unrelated local/shadowed identifier — a bare
 *      `const APPROVAL_TTL_MS` with NO import of the retired export — is NOT a
 *      violation, so declaring it retired does NOT trigger a refusal. Matching is
 *      SPECIFIER-based (`import { X }`, `import X`, re-export), never
 *      bare-identifier. Proven both:
 *        (a) directly on the pure contract core `findUncoveredImporters` — the
 *            single place the specifier-vs-identifier discrimination lives — with
 *            a genuine importer of the SAME name in the SAME file set as a
 *            positive control, so the empty verdict for the shadow file is
 *            demonstrably not vacuous; and
 *        (b) end-to-end through the `create_slice` TOOL CALL (`dispatchTool`, the
 *            layer the live MCP server runs): a slice that `retires` the symbol,
 *            against a repo whose only occurrence is a shadowed local OUTSIDE the
 *            footprint, is ACCEPTED — the gate does not spuriously refuse.
 *
 *   2. THE NO-RETIREMENT PATH IS UNCHANGED. A slice that declares no retired
 *      symbols is created AND re-cut (`update_slice`) exactly as today — the
 *      `retires`-absent path short-circuits before any repo scan, so it behaves
 *      identically to the pre-feature behaviour (backward-compatible, the field
 *      is optional and absent on every existing slice).
 *
 * The tool-level cases drive `dispatchTool` (not the pure helper) so the WIRING
 * of the gate into `create_slice` / `update_slice` is what is verified. They
 * CONSUME the real gate chain (footprint guard, → Ready gate, etc.) via a spec
 * seeded to clear every OTHER gate, so the only variable is the retired-symbol
 * declaration.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";
import { findUncoveredImporters } from "../services/retiredSymbolFootprint";

// The composite spec id `<tep>/<spec>` used across the tool-level cases. Its
// slices carry the tep-qualified handle `TEP-1_SP-1_SL-{k}`.
const SPEC = "1/1";

// The retired export under test. Chosen to echo the real SP-6/11 retirement
// (`APPROVAL_TTL_MS`) so the shadow-local scenario mirrors the motivating case.
const RETIRED = "APPROVAL_TTL_MS";

/**
 * Seed a Spec that clears every OTHER `create_slice` gate — one AC plus a
 * runnable `ac_verifications` entry (mirrors createSliceDagGate.test.ts /
 * SP-6_3_AC-2.test.ts) — into `dir`, which is BOTH the store's working repo and
 * its thinking-space dir (as in the sibling probes). So the retired-symbol gate
 * is the only thing whose verdict can vary.
 */
async function seedSpecInto(dir: string): Promise<ThinkubeStore> {
  const store = new ThinkubeStore(dir, dir);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-1", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

// Minimal HandlerContext (mirrors the sibling dispatch tests): create_slice /
// update_slice only touch `thinkingSpaces.resolve`; `env` is an empty object
// (no thinking-space root, no arming) so no other gate is engaged.
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

// A no-op write gate — the write-permission flag is out of scope for this probe
// (the sibling gate tests inject the same no-op), so every call is authorized.
const allow = () => {};

// ── 1a. PRECISION on the pure core: shadowed local is NOT an importer ─────────

test("SP-6/15 AC3 — findUncoveredImporters: a bare local `const APPROVAL_TTL_MS` (no import) is NOT a violation, while a genuine importer of the same name IS", () => {
  // Two files OUTSIDE the footprint, both mentioning the retired name:
  //   - importer.ts  imports the retired EXPORT  → a real blast-radius violation
  //   - shadow.ts    only declares a LOCAL const → an unrelated identifier
  // The footprint covers the file the slice edits (approvalToken.ts) but neither
  // of these, so a bare-identifier scan would (wrongly) flag BOTH. A
  // specifier-based scan flags ONLY the importer.
  const violations = findUncoveredImporters({
    retiredSymbols: [RETIRED],
    footprintPaths: ["src/approvalToken.ts"],
    repoFiles: [
      {
        path: "src/importer.ts",
        content:
          `import { ${RETIRED} } from "./approvalToken";\n` +
          `export const window = ${RETIRED};\n`,
      },
      {
        path: "src/shadow.ts",
        content:
          `export function ttl(): number {\n` +
          `  const ${RETIRED} = 900_000; // a LOCAL of the same name — no import\n` +
          `  return ${RETIRED};\n` +
          `}\n`,
      },
    ],
  });

  assert.deepEqual(
    violations,
    [{ symbol: RETIRED, importer: "src/importer.ts" }],
    "only the file that IMPORTS the retired export is a violation; a file that " +
      "merely declares a local of the same name must not be flagged (specifier-, " +
      "not identifier-, based) — and the importer proves the empty verdict for " +
      "the shadow file is not vacuous",
  );
});

// ── 1b. THE SHORT-CIRCUIT: no retired symbols ⇒ no scan, no violations ─────────

test("SP-6/15 AC3 — findUncoveredImporters: retiredSymbols=[] short-circuits to [] even when a real importer is present", () => {
  const violations = findUncoveredImporters({
    retiredSymbols: [],
    footprintPaths: [],
    repoFiles: [
      {
        // A file that DOES import a symbol — but with nothing declared retired,
        // there is nothing to scan for, so the result must be empty.
        path: "src/importer.ts",
        content: `import { ${RETIRED} } from "./approvalToken";\n`,
      },
    ],
  });

  assert.deepEqual(
    violations,
    [],
    "an empty retired-symbol set is a total short-circuit — the no-retirement " +
      "path performs no scan and reports no violations",
  );
});

// ── 1c. PRECISION through the TOOL: a shadowed local does not trigger a refusal ─

/** Seed a real git repo whose ONLY occurrence of the retired name is a shadowed
 *  local in a tracked source file — the controlled repo file set the gate reads. */
function initShadowRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp615-ac3-repo-"));
  const git = (...a: string[]) =>
    execFileSync("git", ["-C", repo, ...a], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  // The blast-radius scan will see this file (it is a tracked source file), but
  // it only DECLARES a local — no `import { APPROVAL_TTL_MS }` — so it is not an
  // importer of the retired export and must not become a violation.
  fs.writeFileSync(
    path.join(repo, "src", "shadow.ts"),
    `export function ttl(): number {\n` +
      `  const ${RETIRED} = 900_000; // shadowed local, no import\n` +
      `  return ${RETIRED};\n` +
      `}\n`,
  );
  fs.writeFileSync(path.join(repo, "README.md"), "seed\n");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return repo;
}

test("SP-6/15 AC3 — create_slice with a `retires` declaration is ACCEPTED when the only occurrence is a shadowed local outside the footprint (no false-positive refusal)", async () => {
  const repo = initShadowRepo();
  try {
    const store = await seedSpecInto(repo);
    // The slice declares it retires the symbol, but its footprint is a DIFFERENT
    // file — src/shadow.ts (the bare local) is deliberately uncovered. A
    // specifier-based scan finds no importer of the retired export, so the gate
    // must not refuse.
    const res = (await dispatchTool(
      "create_slice",
      {
        spec: SPEC,
        title: "retire a symbol nobody imports",
        body: "detail",
        files: ["src/newImpl.ts"],
        retires: [RETIRED],
      },
      ctxFor(store),
      allow,
    )) as { slice: string };

    assert.match(
      res.slice,
      /^TEP-1_SP-1_SL-\d+$/,
      "a retirement whose only same-named occurrence is a shadowed local must " +
        "be accepted — the gate fences imports of the retired export, not bare " +
        "identifiers",
    );
    // Total acceptance: the slice file actually landed.
    assert.equal(
      (await store.listSlices(SPEC)).length,
      1,
      "the accepted slice is written (the gate did not silently block the write)",
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── 2. THE NO-RETIREMENT PATH: create + re-cut behave exactly as today ────────

test("SP-6/15 AC3 — a slice that declares NO retired symbols is created exactly as before", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp615-ac3-plain-"));
  try {
    const store = await seedSpecInto(dir);
    // No `retires` → the gate short-circuits before any repo scan, so a plain
    // (non-git) thinking-space dir is sufficient, exactly like today's tests.
    const res = (await dispatchTool(
      "create_slice",
      {
        spec: SPEC,
        title: "ordinary slice, no retirement",
        body: "detail",
        files: ["src/a.ts"],
      },
      ctxFor(store),
      allow,
    )) as { slice: string };

    assert.match(
      res.slice,
      /^TEP-1_SP-1_SL-\d+$/,
      "the no-retirement create path is unchanged — a well-formed slice is created",
    );
    assert.equal((await store.listSlices(SPEC)).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("SP-6/15 AC3 — a slice that declares NO retired symbols is re-cut (update_slice) exactly as before", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp615-ac3-recut-"));
  try {
    const store = await seedSpecInto(dir);
    const created = (await dispatchTool(
      "create_slice",
      {
        spec: SPEC,
        title: "slice to re-cut",
        body: "detail",
        files: ["src/before.ts"],
      },
      ctxFor(store),
      allow,
    )) as { slice: string };

    // A pure re-cut with NO `retires`: replace the footprint. Must succeed and
    // persist the new file set, unchanged from the pre-feature re-cut behaviour.
    await dispatchTool(
      "update_slice",
      { slice: created.slice, files: ["src/after.ts"] },
      ctxFor(store),
      allow,
    );

    const read = (await dispatchTool(
      "get_slice",
      { slice: created.slice },
      ctxFor(store),
      allow,
    )) as { frontmatter: { files?: string[] } };

    assert.deepEqual(
      read.frontmatter.files,
      ["src/after.ts"],
      "the re-cut replaced the footprint wholesale — the no-retirement " +
        "update_slice path is byte-for-byte the current behaviour",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
