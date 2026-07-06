/**
 * SP-6/15 (TEP-6) AC2 — the retirement gate CLEARS the moment the footprint
 * covers the blast radius.
 *
 * AC1's sibling probe proves the refusal fires; THIS probe proves the other
 * half: *"The **same** slice, with every uncovered importer added to a
 * work-unit footprint (or to `files`), is **accepted** — so the gate blocks
 * only the genuine footprint gap and clears the moment the footprint covers the
 * blast radius."*
 *
 * Exercised against the two public surfaces the SPEC CONTRACT names — and
 * nothing about their internals:
 *
 *   1. `findUncoveredImporters({ retiredSymbols, footprintPaths, repoFiles })`
 *      — the pure, injectable core. Adding a previously-uncovered importer to
 *      `footprintPaths` turns its violation into no violation ([]). This is
 *      seam-free (no disk, no board), so it is the load-bearing AC2 assertion.
 *
 *   2. `create_slice` / `update_slice` (the gate wiring) — the held-out probe.
 *      A retiring slice whose on-disk importer is NOT footprinted is refused;
 *      the SAME slice with that importer added to a work-unit footprint OR to
 *      `files` is accepted. The importer file + footprint set + `retires`
 *      declaration are all established by the probe from the documented seams.
 *
 * `installVscodeStub` first — `dispatchTool` builds a `ThinkubeStore` (which
 * requires `vscode`); the require-hook redirects it to the subprocess stub.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";
import {
  findUncoveredImporters,
  type RepoFile,
  type RetiredSymbolViolation,
} from "../services/retiredSymbolFootprint";
import { armApprovalForSlicing } from "../mcp/approvalGateTestSupport";

// ── the controlled repo fixture ──────────────────────────────────────────────
// A retired exported symbol, the module that defines it (the slice edits this),
// and a sibling file that IMPORTS it via a named-import specifier (the blast
// radius the forward-scoped footprint misses). Mirrors the SP-6/11 case that
// motivated the spec (APPROVAL_TTL_MS retired, importers unowned by any unit).
const RETIRED = "APPROVAL_TTL_MS";
const DEF = "src/approvalToken.ts"; // where the symbol lives → the slice removes it
const IMPORTER = "src/window.ts"; // an external consumer → the uncovered importer

const importerSource =
  `import { ${RETIRED} } from "./approvalToken";\n` +
  `export const legacyWindow = ${RETIRED};\n`;
const defSource = `export const ${RETIRED} = 15 * 60 * 1000;\n`;

// ── pure-core AC2: covering the importer clears the violation ─────────────────

test("AC2 (core): adding the previously-uncovered importer to the footprint turns its violation into []", () => {
  const repoFiles: RepoFile[] = [
    { path: IMPORTER, content: importerSource },
    { path: DEF, content: defSource },
  ];

  // Uncovered — the slice footprints only the definition it edits, not the
  // importer → exactly one violation, naming the retired symbol + importer path.
  const before: RetiredSymbolViolation[] = findUncoveredImporters({
    retiredSymbols: [RETIRED],
    footprintPaths: [DEF],
    repoFiles,
  });
  assert.deepEqual(
    before,
    [{ symbol: RETIRED, importer: IMPORTER }],
    "while the importer is outside the footprint, it is a violation",
  );

  // Covered — the importer is added to the footprint union → the gap clears and
  // the check returns no violations. The definition file, though it declares the
  // symbol, is never itself a violation (it is exempt as a footprinted file).
  const after: RetiredSymbolViolation[] = findUncoveredImporters({
    retiredSymbols: [RETIRED],
    footprintPaths: [DEF, IMPORTER],
    repoFiles,
  });
  assert.deepEqual(
    after,
    [],
    "the moment the footprint covers the importer, there is no violation",
  );
});

test("AC2 (core): EVERY uncovered importer must be added — covering one leaves the other flagged; covering all clears", () => {
  // Two importers of the retired symbol: a named import and a re-export (both are
  // specifier-based references the scan counts).
  const A = "src/a.ts";
  const B = "src/b.ts";
  const repoFiles: RepoFile[] = [
    { path: A, content: `import { ${RETIRED} } from "./approvalToken";\n` },
    { path: B, content: `export { ${RETIRED} } from "./approvalToken";\n` },
    { path: DEF, content: defSource },
  ];
  const uncovered = (footprintPaths: string[]) =>
    findUncoveredImporters({
      retiredSymbols: [RETIRED],
      footprintPaths,
      repoFiles,
    });

  // Footprint the definition only → BOTH importers flagged.
  assert.deepEqual(
    uncovered([DEF])
      .map((v) => v.importer)
      .sort(),
    [A, B],
    "both importers are violations until footprinted",
  );

  // Add just one → the OTHER is still flagged (the gate hasn't cleared yet).
  assert.deepEqual(
    uncovered([DEF, A]).map((v) => v.importer),
    [B],
    "covering one importer leaves the still-uncovered one a violation",
  );

  // Add every importer → cleared.
  assert.deepEqual(
    uncovered([DEF, A, B]),
    [],
    "the slice is accepted once EVERY importer is in the footprint union",
  );
});

// ── held-out probe: create_slice / update_slice accept once covered ───────────

/**
 * Seed a temp working-repo (source lives here — the footprint guard resolves it
 * as `store.workspaceRoot`) + a separate thinking-space dir (slice/spec markdown
 * lives here), and a parent Spec with a non-empty `## Acceptance Criteria` so the
 * → Ready gate is satisfied. The importer + definition are written to disk AND
 * git-tracked, so the gate sees them however it enumerates "tracked source
 * files" (`git ls-files` lists staged/committed entries; a directory walk finds
 * the on-disk files). All git is best-effort fixture setup in an isolated tmp
 * repo — never the deliverable's git.
 */
async function setup(spec = "1/1"): Promise<{ store: ThinkubeStore }> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-retire-repo-"));
  const thinkingSpaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-retire-ts-"),
  );
  const store = new ThinkubeStore(repoRoot, thinkingSpaceDir);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );

  const writeSource = (rel: string, content: string) => {
    const abs = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  writeSource(DEF, defSource);
  writeSource(IMPORTER, importerSource);
  try {
    const git = (...a: string[]) =>
      execFileSync("git", a, { cwd: repoRoot, stdio: "ignore" });
    git("init", "-q");
    git("add", "-A");
    git(
      "-c",
      "user.email=fixture@example.com",
      "-c",
      "user.name=fixture",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "seed",
    );
  } catch {
    /* git optional — the on-disk files remain for a directory-walk scan */
  }
  return { store };
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});
const create = async (store: ThinkubeStore, args: Record<string, unknown>) => {
  await armApprovalForSlicing(store, "1/1");
  return dispatchTool(
    "create_slice",
    { spec: "1/1", ...args },
    ctxFor(store),
    () => {},
  );
};
const recut = (store: ThinkubeStore, args: Record<string, unknown>) =>
  dispatchTool("update_slice", args, ctxFor(store), () => {});

test("AC2: create_slice ACCEPTS the retiring slice once its importer is in a work-unit footprint (refused while uncovered)", async () => {
  // The SAME retiring slice, differing ONLY by whether the on-disk importer of
  // the retired symbol is inside the declared footprint.
  const retires = [RETIRED];
  const title = "retire the approval TTL constant";
  const body = "remove APPROVAL_TTL_MS and update its importer";

  // Precondition — uncovered: the importer is NOT footprinted, so the gate is
  // live and genuinely sees it → refused, naming the retired symbol + importer.
  {
    const { store } = await setup();
    await assert.rejects(
      create(store, {
        title,
        body,
        retires,
        work_units: [{ footprint: [DEF], execution: "serial", note: "retire" }],
      }),
      (err: Error) => {
        assert.match(
          err.message,
          new RegExp(RETIRED),
          "the refusal names the retired symbol",
        );
        assert.match(
          err.message,
          /window\.ts/,
          "the refusal names the uncovered importer's path",
        );
        return true;
      },
    );
  }

  // AC2 — covered: the same slice with the importer added to a work-unit
  // footprint is ACCEPTED (a real slice handle comes back).
  {
    const { store } = await setup();
    const res = (await create(store, {
      title,
      body,
      retires,
      work_units: [
        {
          footprint: [DEF, IMPORTER],
          execution: "serial",
          note: "retire the constant and update its importer",
        },
      ],
    })) as { slice: string };
    assert.match(
      res.slice,
      /^TEP-\d+_SP-\d+_SL-\d+$/,
      "the retiring slice is created once the importer is footprinted",
    );
  }
});

test("AC2: adding the importer to `files` (instead of a work-unit footprint) also clears the gate", async () => {
  // The footprint union is `work_units[].footprint` ∪ `files` — so covering the
  // importer via `files` is equally sufficient.
  const { store } = await setup();
  const res = (await create(store, {
    title: "retire the approval TTL constant",
    body: "remove APPROVAL_TTL_MS",
    retires: [RETIRED],
    files: [IMPORTER],
    work_units: [{ footprint: [DEF], execution: "serial", note: "retire" }],
  })) as { slice: string };
  assert.match(
    res.slice,
    /^TEP-\d+_SP-\d+_SL-\d+$/,
    "an importer covered via `files` clears the gate just as a footprint does",
  );
});

test("AC2: the update_slice re-cut is likewise ACCEPTED once the importer is covered", async () => {
  const { store } = await setup();

  // Baseline: a slice with no retirement declared (the gate short-circuits) —
  // gives us a handle to re-cut.
  const base = (await create(store, {
    title: "baseline slice",
    body: "no retirement declared yet",
    work_units: [{ footprint: [DEF], execution: "serial", note: "edit def" }],
  })) as { slice: string };

  // The re-cut declares the retirement AND extends the footprint to cover the
  // importer (here via `files`) → accepted, mirroring create_slice.
  await assert.doesNotReject(
    recut(store, {
      slice: base.slice,
      retires: [RETIRED],
      files: [IMPORTER],
      work_units: [{ footprint: [DEF], execution: "serial", note: "retire" }],
    }),
    "the re-cut that both declares the retirement and covers its importer is accepted",
  );
});
