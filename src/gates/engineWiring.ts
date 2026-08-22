/**
 * Engine wiring: which `src/engine/` modules no product (non-test) file
 * reaches, directly or transitively, from `src/extension.ts`.
 *
 * No I/O contract: this module reads nothing from disk itself — every file
 * it looks at arrives already read, in the `files` array its caller builds.
 * It never imports `vscode` and never imports a model client; the caller
 * that walks the real tree and the caller that talks to a model both stay
 * outside it, so this module can be exercised on a synthetic file map with
 * no disk read, no vscode host, and no model round.
 */

/** One source file, already read: its repo-relative path and its text. */
export interface RepoFile {
  path: string;
  content: string;
}

const IMPORT_RE = /^\s*(?:import|export)\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']/;
const IMPORT_CLAUSE_RE = /\bfrom\s+["']([^"']+)["']/g;

/** The module specifiers a file imports or re-exports, in source order. */
function importsOf(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = IMPORT_CLAUSE_RE.exec(line);
    IMPORT_CLAUSE_RE.lastIndex = 0;
    if (m) {
      out.push(m[1]);
      continue;
    }
    const bare = IMPORT_RE.exec(line);
    if (bare) out.push(bare[1]);
  }
  return out;
}

function isTestPath(p: string): boolean {
  return /\.test\.tsx?$/.test(p);
}

/** Resolves a relative import specifier against the importing file's own
 *  directory, to the repo-relative path of the file it names — trying the
 *  extensions and the `/index` form a bundler would, in order. */
function resolveImport(fromPath: string, spec: string, known: Set<string>): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const dir = fromPath.split("/").slice(0, -1);
  const parts = spec.split("/");
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") dir.pop();
    else dir.push(part);
  }
  const base = dir.join("/");
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  return candidates.find((c) => known.has(c));
}

/**
 * Every `src/engine/` module not reached, directly or transitively, from
 * `entry` — walking only product (non-test) files, so a module only a test
 * imports still counts as unreached, and reach never launders through a
 * module that is itself unreached.
 */
export function unreachedEngineModules(opts: { entry: string; files: RepoFile[] }): RepoFile[] {
  const { entry, files } = opts;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const known = new Set(byPath.keys());
  const engineFiles = files.filter((f) => f.path.startsWith("src/engine/") && !isTestPath(f.path));

  const reached = new Set<string>();
  const queue: string[] = known.has(entry) ? [entry] : [];
  while (queue.length) {
    const current = queue.shift()!;
    if (reached.has(current)) continue;
    reached.add(current);
    const file = byPath.get(current);
    if (!file || isTestPath(current)) continue;
    for (const spec of importsOf(file.content)) {
      const resolved = resolveImport(current, spec, known);
      if (resolved && !reached.has(resolved)) queue.push(resolved);
    }
  }

  return engineFiles.filter((f) => !reached.has(f.path));
}

type Verdict = "wire" | "retire" | "fold";

interface WiringEntry {
  path: string;
  verdict: Verdict;
  reason: string;
}

interface WiringProblem {
  path: string;
  reason: string;
}

export interface WiringLedger {
  entries: WiringEntry[];
  problems: WiringProblem[];
}

const KNOWN_VERDICTS: readonly string[] = ["wire", "retire", "fold"];
const ENTRY_RE = /^-\s*`([^`]+)`\s*—\s*\*\*([^*]+)\*\*:\s*(.*)$/;

/**
 * Parses the `- \`path\` — **verdict**: reason.` lines of ENGINE-WIRING.md.
 * One entry per listed module; an unrecognized verdict or a blank reasoning
 * sentence is reported as a named problem rather than thrown or silently
 * accepted.
 */
export function parseWiringLedger(md: string): WiringLedger {
  const entries: WiringEntry[] = [];
  const problems: WiringProblem[] = [];
  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("-")) continue;
    const m = ENTRY_RE.exec(line);
    if (!m) continue;
    const [, path, verdictWord, reason] = m;
    const verdict = verdictWord.trim();
    const trimmedReason = reason.trim();
    if (!KNOWN_VERDICTS.includes(verdict)) {
      problems.push({ path, reason: `unrecognized verdict "${verdict}"` });
      continue;
    }
    if (!trimmedReason) {
      problems.push({ path, reason: "blank reasoning sentence" });
      continue;
    }
    entries.push({ path, verdict: verdict as Verdict, reason: trimmedReason });
  }
  return { entries, problems };
}
