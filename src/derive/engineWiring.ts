// Derives the engine's uncalled surface from the source tree itself (SP-TEP-cmxela-30).
//
// The imported engine (`src/engine/**`) is vendored v1 code; ENGINE-WIRING.md judges which of its
// modules no product path still calls. That judgement must be DERIVED from the tree, not
// remembered by hand, or the ledger silently drifts from the code the day someone deletes a
// caller. `unwiredEngineModules` is the derivation; `parseWiringLedger` reads the ledger back so
// the same file can be checked against its own claim.
//
// Pure / total / deterministic — no disk read, no `vscode`, no model — takes its file map as an
// argument, matching the stated purity of `testImpactFootprint.ts`.

/** A repo source file injected as path→content (repo-relative path + full text). */
export interface EngineFile {
  path: string;
  content: string;
}

/** Module-path extensions a specifier may already carry — none is appended when one is present. */
const SPECIFIER_EXT_RE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

/**
 * Normalize a repo-relative path for comparison: drop a leading `./` and collapse `\` to `/`.
 * Mirrors `testImpactFootprint.ts`.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Strip line (`//`) and block (`/* *\/`) comments so a commented-out import does not read as a
 * live one. Mirrors `testImpactFootprint.ts` / `retiredSymbolFootprint.ts`.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** One import/export-from edge found in a file, tagged by whether it is a re-export. */
interface Edge {
  specifier: string;
  /** `export * from "X"` / `export { Y } from "X"` — re-exports, never a direct caller. */
  isReExport: boolean;
}

/**
 * Collect the RELATIVE module specifiers a file imports or re-exports, tagging each as a
 * re-export edge (`export … from "X"`) or a call edge (`import … from "X"` / bare `import "X"`).
 * A bare package specifier (`vscode`, `node:test`) is dropped — it is never a repo file.
 */
function collectEdges(content: string): Edge[] {
  const src = stripComments(content);
  const edges: Edge[] = [];
  // `export … from "X"` (named, `*`, or type re-export) — a re-export edge.
  const exportFromRe = /\bexport\s+(?:[^;]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  // `import … from "X"` (named, default, namespace, or type import) — a call edge.
  const importFromRe = /\bimport\s+(?:[^;]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  // Side-effect `import "X"` (no binding clause) — a call edge.
  const bareImportRe = /\bimport\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = exportFromRe.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith(".")) edges.push({ specifier: spec, isReExport: true });
  }
  while ((m = importFromRe.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith(".")) edges.push({ specifier: spec, isReExport: false });
  }
  while ((m = bareImportRe.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith(".")) edges.push({ specifier: spec, isReExport: false });
  }
  return edges;
}

/**
 * Resolve a relative module specifier LEXICALLY against the importing file's directory — no
 * disk, no index resolution. Mirrors `testImpactFootprint.ts`.
 */
function resolveLexically(fromDir: string, specifier: string): string {
  const segs = fromDir === "" ? [] : fromDir.split("/");
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  let resolved = segs.join("/");
  if (!SPECIFIER_EXT_RE.test(resolved)) resolved += ".ts";
  return resolved;
}

/** Directory portion of a normalized repo-relative path (`""` for a top-level file). */
function dirOf(normalized: string): string {
  const i = normalized.lastIndexOf("/");
  return i === -1 ? "" : normalized.slice(0, i);
}

/**
 * A path is test-shaped only if a runner could execute it directly (never imported by
 * product code) — mirrors the one-rule reading of `isTestPath` established in
 * `testHomes.ts` / `testImpactFootprint.ts`. A check has no wiring verdict of its own; it is
 * never a candidate "engine module" for the ledger.
 */
function isTestShaped(normalized: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(normalized);
}

/**
 * Pure + total. Returns the repo-relative paths, under `src/engine/`, of every module in `files`
 * that no product path ever calls — sorted ascending so two runs over the same input agree.
 *
 * A "product caller" is a CALL edge (a real `import … from "X"`, not `export … from "X"`)
 * reached, transitively, from one of `entries`. Reachability itself follows BOTH call and
 * re-export edges — a barrel (`export * from "./core/watchdog"`) still carries the walk into the
 * files it re-exports, so anything reachable only past a barrel is still visited — but a
 * re-export edge alone never counts as a call on the module it points at. A module gains a
 * caller only when some file the entries reach imports a name directly from ITS OWN path.
 *
 * Entry files are themselves treated as called (the runtime invokes them directly), so they are
 * never reported as unwired even when nothing in `files` imports them. A test-shaped path (see
 * {@link isTestShaped}) is never a candidate — a check is run by a test runner, not called by
 * product code, so it has no wiring verdict to carry.
 */
export function unwiredEngineModules(
  files: readonly EngineFile[],
  entries: readonly string[],
): string[] {
  const byPath = new Map<string, EngineFile>();
  for (const f of files) byPath.set(normalizePath(f.path), f);

  const entrySet = new Set(entries.map(normalizePath));
  const reachable = new Set<string>();
  const called = new Set<string>();
  for (const e of entrySet) called.add(e);

  const queue: string[] = [...entrySet].filter((e) => byPath.has(e));
  for (const e of queue) reachable.add(e);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const file = byPath.get(current);
    if (!file) continue;
    const dir = dirOf(current);
    for (const edge of collectEdges(file.content)) {
      const target = resolveLexically(dir, edge.specifier);
      if (!byPath.has(target)) continue;
      if (!edge.isReExport) called.add(target);
      if (!reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }

  const unwired: string[] = [];
  for (const p of byPath.keys()) {
    if (!p.startsWith("src/engine/")) continue;
    if (isTestShaped(p)) continue;
    if (called.has(p)) continue;
    unwired.push(p);
  }
  unwired.sort();
  return unwired;
}

/** One row read back out of the wiring ledger. */
export interface WiringLedgerRow {
  module: string;
  verdict: "wire" | "retire" | "fold";
  reason: string;
}

const VERDICTS = new Set(["wire", "retire", "fold"]);

/**
 * Pure + total (throws on a malformed row — see below). Reads a standard Markdown pipe table out
 * of `markdown`: a header row of exactly `Module | Verdict | Reason`, the standard dash-only
 * separator row, then one data row per ledger entry (`path | verdict | reason`, cells trimmed).
 * The header and separator rows are recognized and skipped, never parsed as data.
 *
 * Throws if a data row's verdict cell is not exactly `wire`, `retire` or `fold` — an unrecognized
 * verdict is refused rather than returned.
 */
export function parseWiringLedger(markdown: string): WiringLedgerRow[] {
  const rows: WiringLedgerRow[] = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("|")) continue;
    const cells = trimmedLine
      .slice(1, trimmedLine.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (cells.length !== 3) continue;
    const [module, verdict, reason] = cells;
    if (module === "Module" && verdict === "Verdict" && reason === "Reason") continue;
    if (/^-+$/.test(module) && /^-+$/.test(verdict) && /^-+$/.test(reason)) continue;
    if (!VERDICTS.has(verdict)) {
      throw new Error(`engineWiring: unrecognized verdict "${verdict}" for module "${module}"`);
    }
    rows.push({ module, verdict: verdict as WiringLedgerRow["verdict"], reason });
  }
  return rows;
}
