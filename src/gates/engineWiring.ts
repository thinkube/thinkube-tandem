// Author-time engine-wiring reachability gate (SL-5, TEP-cmxela-12).
//
// The engine directory (`src/engine/`) carries the imported v1 orchestration surface plus a growing
// set of v2-authored modules. Nothing enforces that every module under it is actually reached from
// the product — a module can sit there, fully typed and tested, with its only importer being its own
// `.test.ts` file. This module is the pure core of a gate that finds those modules and reads back the
// ledger (`ENGINE-WIRING.md`) that records what each one is for: wired in on a next pass, retired, or
// folded into a sibling.
//
// Pure / total / deterministic — no disk read, no `vscode`, no model-client module — so it is
// unit-testable with synthetic `{ path, content }` file maps, exactly the convention stated at
// `src/engine/testImpactFootprint.ts:17-20`.

/** A repo source file injected as path→content (repo-relative path + full text). */
export interface RepoFile {
  path: string;
  content: string;
}

/** The set of engine-wiring ledger verdicts a module may carry. */
export type WiringVerdict = "wire" | "retire" | "fold";

const VERDICTS: ReadonlySet<string> = new Set(["wire", "retire", "fold"]);

/** One parsed ledger entry: the module it is about, its verdict, and why. */
export interface WiringEntry {
  module: string;
  verdict: WiringVerdict;
  reason: string;
}

/** A successful ledger parse, or a named refusal — never a throw. */
export type WiringParseResult =
  | { ok: true; entries: WiringEntry[] }
  | { ok: false; reason: string };

/** Module-path extensions a specifier may already carry — none is appended when one is present. */
const SPECIFIER_EXT_RE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

/**
 * Normalize a repo-relative path for comparison: drop a leading `./` and collapse `\` to `/`, so an
 * import target and a repo-file path that denote the same file compare equal regardless of that
 * cosmetic difference. Mirrors `testImpactFootprint.ts`.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * True for a file recognized as test-shaped by name: a `.test.` extension before the language
 * suffix, matching the local convention read at `src/engine/testImpactFootprint.ts:55-59`.
 */
function isTestPath(normalized: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(normalized);
}

/**
 * Strip line (`//`) and block (`/* *\/`) comments so a commented-out import does not read as a live
 * one. Pragmatic — does not model string literals — but errs toward fewer matches, the safe side for
 * a reachability scan. Mirrors `testImpactFootprint.ts`.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Collect the relative (`.`-leading) module specifiers a file imports, re-exports or side-effects. */
function relativeImportSpecifiers(content: string): string[] {
  const src = stripComments(content);
  const specifiers: string[] = [];
  const importFromRe = /\bimport\s+(?:type\s+)?(?:[^"'()]+?\sfrom\s+)?["']([^"']+)["']/g;
  const exportFromRe = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[^\s]+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
  for (const re of [importFromRe, exportFromRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (spec.startsWith(".")) specifiers.push(spec);
    }
  }
  return specifiers;
}

/** Resolve a relative import specifier from `fromPath` against the known repo-file paths. */
function resolveSpecifier(fromPath: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const joined = normalizePath(joinPosix(fromDir, specifier));
  const candidates = SPECIFIER_EXT_RE.test(joined)
    ? [joined]
    : [
        `${joined}.ts`,
        `${joined}.tsx`,
        `${joined}/index.ts`,
        `${joined}/index.tsx`,
      ];
  for (const c of candidates) if (known.has(c)) return c;
  return undefined;
}

/** POSIX-style path join that also resolves `..` and `.` segments, without touching the filesystem. */
function joinPosix(dir: string, specifier: string): string {
  const segments = `${dir}/${specifier}`.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Walk the relative-import graph of `files` starting at `productEntry`, and return the repo-relative
 * paths of every `src/engine/` file the walk never reaches. Test-shaped files (see {@link isTestPath})
 * are graph nodes — they can still be walked TO as an edge target — but are never a traversal root and
 * are never reported, even when the walk never visits them.
 */
export function unreachedEngineModules(args: { files: RepoFile[]; productEntry: string }): string[] {
  const { files, productEntry } = args;
  const byPath = new Map<string, RepoFile>();
  for (const f of files) byPath.set(normalizePath(f.path), { path: normalizePath(f.path), content: f.content });

  const entry = normalizePath(productEntry);
  const reached = new Set<string>();
  const stack: string[] = [];
  if (byPath.has(entry)) stack.push(entry);

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (reached.has(current)) continue;
    reached.add(current);
    const file = byPath.get(current);
    if (!file) continue;
    for (const spec of relativeImportSpecifiers(file.content)) {
      const resolved = resolveSpecifier(current, spec, new Set(byPath.keys()));
      if (resolved && !reached.has(resolved)) stack.push(resolved);
    }
  }

  const unreached: string[] = [];
  for (const path of byPath.keys()) {
    if (!path.startsWith("src/engine/")) continue;
    if (isTestPath(path)) continue;
    if (!reached.has(path)) unreached.push(path);
  }
  return unreached;
}

/** A ledger bullet's head: a backtick module path, an em dash, the verdict word. */
const BULLET_HEAD_RE = /^-\s+`([^`]+)`\s+—\s+([^:\n]+?)(:(.*))?$/;

/** True for a line that starts a new ledger bullet (used to end a reason's continuation lines). */
const BULLET_START_RE = /^-\s+`/;

/**
 * Parse the engine-wiring ledger markdown into one entry per listed module. A bullet's reasoning
 * sentence may continue onto following indented lines (a soft-wrapped sentence) up to the next bullet
 * or a blank line; those continuation lines are joined into the same entry's `reason`. Refuses — never
 * throws — on a verdict outside `wire` / `retire` / `fold`, on a bullet with no colon at all (no
 * reason), or on a bullet whose reason is empty or whitespace-only across all its lines.
 */
export function parseWiringLedger(markdown: string): WiringParseResult {
  const lines = markdown.split("\n");
  const entries: WiringEntry[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = BULLET_HEAD_RE.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const [, module, verdictWordRaw, hasColon, firstReasonPart] = m;
    const verdictWord = verdictWordRaw.trim();
    const reasonParts = hasColon !== undefined ? [firstReasonPart] : [];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === "" || BULLET_START_RE.test(next)) break;
      reasonParts.push(next);
      i++;
    }
    const reason = reasonParts.join(" ").trim();

    if (!VERDICTS.has(verdictWord)) {
      return { ok: false, reason: `${module}: verdict "${verdictWord}" is not one of wire, retire, fold` };
    }
    if (hasColon === undefined) {
      return { ok: false, reason: `${module}: reasoning sentence is missing` };
    }
    if (reason === "") {
      return { ok: false, reason: `${module}: reasoning sentence is empty` };
    }
    entries.push({ module, verdict: verdictWord as WiringVerdict, reason });
  }

  return { ok: true, entries };
}
