/**
 * Engine wiring: which engine modules nothing in the product reaches, and
 * what the wiring ledger (ENGINE-WIRING.md) says about them.
 *
 * `unreachedEngineModules` walks the static `import ... from "..."` graph
 * from the product entry point and reports every `src/engine/` module no
 * reachable product (non-test) file imports, directly or transitively. An
 * import written inside a `.test.ts` file never establishes reach — a
 * module only test files import is exactly the case this check exists to
 * name. `parseWiringLedger` reads the ledger's markdown back into entries
 * carrying a verdict (`wire` | `retire` | `fold`) and a reasoning sentence,
 * refusing anything else with a named reason instead of throwing.
 *
 * Pure / total / deterministic — no disk read, no `vscode`, no model
 * client — so it is unit-testable with synthetic `{ path, content }` file
 * maps, matching the convention in `src/engine/testImpactFootprint.ts:17-20`.
 */

/** A repo source file supplied as path→content (repo-relative path + full text). */
export interface RepoFile {
  path: string;
  content: string;
}

/** The whole tree to scan, plus the product's entry point to reach from. */
export interface WiringScanInput {
  /** Repo-relative path of the product entry point, e.g. "src/extension.ts". */
  entry: string;
  /** Every source file in the tree being scanned (not only src/engine/). */
  files: RepoFile[];
}

/** An engine module (repo-relative path) that no product file reaches. */
export interface UnreachedEngineModule {
  path: string;
}

const ENGINE_PREFIX = "src/engine/";
const TEST_SUFFIX_RE = /\.test\.tsx?$/;
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;]*?\bfrom\s+["']([^"']+)["']/g;
const SOURCE_EXT_RE = /\.tsx?$/;

function isTestFile(path: string): boolean {
  return TEST_SUFFIX_RE.test(path);
}

function isEngineModule(path: string): boolean {
  return path.startsWith(ENGINE_PREFIX);
}

/** Repo-relative directory of a repo-relative file path ("" at the root). */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Resolves a relative import specifier against the importing file's directory. */
function resolveSpecifier(fromDir: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const parts = (fromDir ? fromDir.split("/") : []).concat(specifier.split("/"));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** Every relative import specifier a file's source text names, in order. */
function importSpecifiers(content: string): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content))) out.push(m[1]);
  return out;
}

/**
 * Every engine module (`src/engine/...`) that no product (non-test) file
 * reaches, directly or transitively, from `input.entry`. Reach follows
 * static relative imports only, resolved against the in-memory file map —
 * an import inside a `.test.ts` file never establishes reach, however
 * many test files carry it or how deep the chain runs before it reaches a
 * genuine product importer.
 */
export function unreachedEngineModules(input: WiringScanInput): UnreachedEngineModule[] {
  const byResolved = new Map<string, RepoFile>();
  for (const f of input.files) {
    if (!SOURCE_EXT_RE.test(f.path)) continue;
    byResolved.set(f.path.replace(SOURCE_EXT_RE, ""), f);
  }

  const resolve = (fromPath: string, specifier: string): RepoFile | undefined => {
    const resolved = resolveSpecifier(dirOf(fromPath), specifier);
    if (resolved === undefined) return undefined;
    const direct = byResolved.get(resolved);
    if (direct) return direct;
    return byResolved.get(`${resolved}/index`);
  };

  const reached = new Set<string>();
  const visit = (file: RepoFile) => {
    if (reached.has(file.path)) return;
    reached.add(file.path);
    for (const specifier of importSpecifiers(file.content)) {
      const target = resolve(file.path, specifier);
      if (target) visit(target);
    }
  };

  const entry = byResolved.get(input.entry.replace(SOURCE_EXT_RE, ""));
  if (entry && !isTestFile(entry.path)) visit(entry);

  // A second pass folds in every other product (non-test) file's own
  // imports, so reach holds for the whole product graph, not only what
  // hangs off the single entry point's transitive closure.
  for (const f of input.files) {
    if (isTestFile(f.path)) continue;
    if (!reached.has(f.path)) continue;
    for (const specifier of importSpecifiers(f.content)) {
      const target = resolve(f.path, specifier);
      if (target) visit(target);
    }
  }

  const unreached: UnreachedEngineModule[] = [];
  for (const f of input.files) {
    if (!isEngineModule(f.path)) continue;
    if (isTestFile(f.path)) continue;
    if (reached.has(f.path)) continue;
    unreached.push({ path: f.path });
  }
  return unreached;
}

/** A verdict the wiring ledger may record for an unreached engine module. */
export type WiringVerdict = "wire" | "retire" | "fold";

const VALID_VERDICTS: ReadonlySet<string> = new Set(["wire", "retire", "fold"]);

/** One ledger entry: a module, its verdict, and the sentence saying why. */
export interface WiringEntry {
  path: string;
  verdict: WiringVerdict;
  reason: string;
}

/** A ledger line that failed to parse into a valid entry, and why. */
export interface WiringProblem {
  path: string;
  reason: string;
}

/** The ledger's entries, plus any lines that failed to parse. */
export interface WiringLedger {
  entries: WiringEntry[];
  problems: WiringProblem[];
}

// One bullet per module: `path` — **verdict**: reasoning sentence.
const LEDGER_LINE_RE = /^\s*[-*]\s*`([^`]+)`\s*(?:—|-{1,2})\s*\*\*([^*]+)\*\*\s*:\s*(.*)$/;

/**
 * Reads the wiring ledger's raw markdown text back into entries carrying
 * their verdict and reasoning sentence. A verdict outside `wire`, `retire`,
 * `fold`, or a missing/blank reason, is reported as a problem naming the
 * module's path rather than thrown.
 */
export function parseWiringLedger(markdown: string): WiringLedger {
  const entries: WiringEntry[] = [];
  const problems: WiringProblem[] = [];

  for (const rawLine of markdown.split("\n")) {
    const m = LEDGER_LINE_RE.exec(rawLine);
    if (!m) continue;
    const [, path, verdictWord, reasonRaw] = m;
    const verdict = verdictWord.trim().toLowerCase();
    const reason = reasonRaw.trim();

    if (!VALID_VERDICTS.has(verdict)) {
      problems.push({
        path,
        reason: `"${path}" carries an unrecognized verdict "${verdictWord.trim()}" — must be wire, retire, or fold`,
      });
      continue;
    }
    if (reason.length === 0) {
      problems.push({
        path,
        reason: `"${path}" carries no reasoning sentence for its ${verdict} verdict`,
      });
      continue;
    }
    entries.push({ path, verdict: verdict as WiringVerdict, reason });
  }

  return { entries, problems };
}
