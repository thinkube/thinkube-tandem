/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a check's doubles must agree with, read from the tree.
 *
 * A check that fakes a collaborator the code reaches through a seam — a
 * pool, a client, a connection — passes only code that calls exactly the
 * methods the fake has. A fake with fewer methods than the production path
 * calls fails every correct implementation and passes only one that skips
 * a call. Two readings close that gap before the check is written: the
 * repository's shared test fixtures, which a check reuses instead of
 * re-faking, and, for every seam in the production code, the methods the
 * production path calls on it.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ignoredFor, worthWalking } from "../core/ignored";
import { isProbePath, isTestPath } from "../core/testShape";

/** A production function that takes a collaborator and calls through it. */
export interface Seam {
  file: string;
  fn: string;
  params: string[];
  /** Each object the function calls methods on: a parameter, or a value it
   *  obtained from one (`connection = pool.connect()`, with `from` saying how). */
  objects: { name: string; from?: string; methods: string[] }[];
}

type SeamObject = Seam["objects"][number];

export interface SharedFixture {
  path: string;
  source: string;
}

const SOURCE = /\.(py|[cm]?[jt]sx?)$/;
const TS_DECLARATION = /\.d\.[cm]?ts$/;

/** Files a test runner loads as shared setup or helpers rather than as a
 *  test: pytest's conftest.py, a vitest/jest setup file, a helpers or
 *  fixtures module under a test home, a `*.fixture.*` module, a Go
 *  testutil package. */
export function isSharedFixturePath(rel: string): boolean {
  const t = rel.replace(/\\/g, "/");
  if (isProbePath(t)) return false;
  if (/(^|\/)conftest\.py$/.test(t)) return true;
  if (!/\.(py|[cm]?[jt]sx?|go)$/.test(t) || TS_DECLARATION.test(t)) return false;
  if (/(^|\/)(vitest|jest)\.setup\.[^/]+$/.test(t)) return true;
  if (/(^|\/)(setupTests|test-?setup|setup-?tests?)\.[^/]+$/i.test(t)) return true;
  if (/\.fixtures?\.[cm]?[jt]sx?$/.test(t)) return true;
  if (/(^|\/)(testutils?|test-utils|test_utils|testhelpers|test_helpers)\//.test(t)) return true;
  return /(^|\/)(tests?|__tests__|spec)\/(.+\/)?(helpers|fixtures|support|factories)\//.test(t);
}

/** Every file of the tree a walk reaches, repository-relative, minus what
 *  the repository's own ignore rules skip. */
async function treeFiles(tree: string): Promise<string[]> {
  const out: string[] = [];
  const skip = ignoredFor(tree);
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (worthWalking(e.name, skip)) await walk(abs);
        continue;
      }
      out.push(path.relative(tree, abs).split(path.sep).join("/"));
    }
  };
  await walk(tree);
  return out.sort();
}

/** The repository's shared test fixtures, with their source. */
export async function sharedFixtures(tree: string): Promise<SharedFixture[]> {
  const out: SharedFixture[] = [];
  for (const rel of (await treeFiles(tree)).filter(isSharedFixturePath))
    out.push({ path: rel, source: await fs.readFile(path.join(tree, rel), "utf8") });
  return out;
}

/** Every seam of the repository's production code. */
export async function productionSeams(tree: string): Promise<Seam[]> {
  const out: Seam[] = [];
  for (const rel of await treeFiles(tree)) {
    if (!SOURCE.test(rel) || TS_DECLARATION.test(rel) || isTestPath(rel) || isSharedFixturePath(rel)) continue;
    out.push(...seamsInSource(rel, await fs.readFile(path.join(tree, rel), "utf8")));
  }
  return out;
}

/** Type names that describe a value, never a collaborator: a parameter
 *  typed only by these is data, and a method called on it is not a seam. */
const VALUE_TYPES = new Set([
  "str", "int", "float", "bool", "bytes", "bytearray", "complex", "None", "UUID", "uuid", "Decimal",
  "datetime", "date", "time", "timedelta", "Path", "PurePath", "dict", "Dict", "list", "List", "tuple",
  "Tuple", "set", "Set", "frozenset", "Optional", "Union", "Literal", "Sequence", "Mapping", "Iterable",
  "string", "number", "boolean", "bigint", "symbol", "undefined", "null", "Date", "RegExp", "Array",
  "ReadonlyArray", "Record", "Partial", "Readonly", "readonly", "typeof", "Buffer", "URL",
]);

function isValueType(annotation: string | undefined): boolean {
  if (!annotation) return false;
  const names = annotation.match(/[A-Za-z_][\w]*/g) ?? [];
  return names.length > 0 && names.every((n) => VALUE_TYPES.has(n));
}

/** The text between the bracket at `open` and its partner. */
function balanced(src: string, open: number, o: string, c: string): { inner: string; end: number } | undefined {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return { inner: src.slice(open + 1, i), end: i };
  }
  return undefined;
}

/** Split a parameter list on its top-level commas. */
function splitTop(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    // The `>` of an arrow (`=>`, `->`) closes nothing.
    const arrow = ch === ">" && /[=-]$/.test(cur);
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch) && !arrow) depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** A parameter's name and its annotation, in either language's syntax. */
function param(raw: string): { name: string; annotation?: string } | undefined {
  const p = raw.replace(/^(\*\*?|\.\.\.)/, "").replace(/^(public|private|protected|readonly)\s+/, "");
  const m = /^([A-Za-z_$][\w$]*)\??\s*(?::\s*([^=]+))?/.exec(p);
  if (!m || ["self", "cls", "this"].includes(m[1])) return undefined;
  return { name: m[1], ...(m[2] ? { annotation: m[2].trim() } : {}) };
}

/** The seam a function body makes of its parameters. */
function seamOf(file: string, fn: string, rawParams: string, body: string): Seam | undefined {
  const params = splitTop(rawParams).map(param).filter((p): p is { name: string; annotation?: string } => !!p);
  const tracked = new Map<string, SeamObject>();
  for (const p of params) if (!isValueType(p.annotation)) tracked.set(p.name, { name: p.name, methods: [] });
  if (!tracked.size) return undefined;
  // Values obtained from a tracked object are tracked too, in the order the
  // body obtains them.
  const derive = [
    /(?:\b(?:const|let|var)\s+)?\b([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g,
    /\bwith\s+(?:await\s+)?([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\([^)]*\)\s+as\s+([A-Za-z_$][\w$]*)/g,
  ];
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of body.matchAll(derive[0])) {
      if (tracked.has(m[2]) && !tracked.has(m[1])) {
        tracked.set(m[1], { name: m[1], from: `${m[2]}.${m[3]}()`, methods: [] });
        grew = true;
      }
    }
    for (const m of body.matchAll(derive[1])) {
      if (tracked.has(m[1]) && !tracked.has(m[3])) {
        tracked.set(m[3], { name: m[3], from: `${m[1]}.${m[2]}()`, methods: [] });
        grew = true;
      }
    }
  }
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\??\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    const o = tracked.get(m[1]);
    if (o && !o.methods.includes(m[2])) o.methods.push(m[2]);
  }
  const objects = [...tracked.values()].filter((o) => o.methods.length);
  if (!objects.length) return undefined;
  return { file, fn, params: params.map((p) => p.name), objects };
}

/** The seams one production file defines. */
export function seamsInSource(file: string, source: string): Seam[] {
  return file.endsWith(".py") ? pythonSeams(file, source) : scriptSeams(file, source);
}

function pythonSeams(file: string, source: string): Seam[] {
  const out: Seam[] = [];
  const def = /^([ \t]*)(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm;
  for (const m of source.matchAll(def)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const sig = balanced(source, open, "(", ")");
    if (!sig) continue;
    const indent = m[1].length;
    const lines = source.slice(sig.end).split("\n").slice(1);
    const body: string[] = [];
    for (const line of lines) {
      if (line.trim() && line.length - line.trimStart().length <= indent) break;
      body.push(line);
    }
    const seam = seamOf(file, m[2], sig.inner, body.join("\n"));
    if (seam) out.push(seam);
  }
  return out;
}

const NOT_A_FUNCTION = new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "constructor"]);

function scriptSeams(file: string, source: string): Seam[] {
  const out: Seam[] = [];
  const heads = [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?\(/g,
    /^[ \t]*(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*\(/gm,
  ];
  const seen = new Set<number>();
  for (const head of heads)
    for (const m of source.matchAll(head)) {
      if (NOT_A_FUNCTION.has(m[1])) continue;
      const open = (m.index ?? 0) + m[0].length - 1;
      if (seen.has(open)) continue;
      seen.add(open);
      const sig = balanced(source, open, "(", ")");
      if (!sig) continue;
      const after = source.slice(sig.end + 1);
      const brace = /^\s*(?::[^{=;]+)?\s*(=>\s*)?\{/.exec(after);
      if (!brace) continue;
      const body = balanced(source, sig.end + 1 + brace[0].length - 1, "{", "}");
      if (!body) continue;
      const seam = seamOf(file, m[1], sig.inner, body.inner);
      if (seam) out.push(seam);
    }
  return out;
}

/** Whether a shared fixture already doubles a seam: some fixture defines
 *  every method the production path calls on it. */
export function fixtureCovers(fixtures: readonly SharedFixture[], seam: Seam): boolean {
  const methods = [...new Set(seam.objects.flatMap((o) => o.methods))];
  return fixtures.some((f) =>
    methods.every((name) => {
      const m = name.replace(/\$/g, "\\$");
      return new RegExp(`\\bdef\\s+${m}\\s*\\(|\\b${m}\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{|\\b${m}\\s*[:=]\\s*(?:async\\s*)?(?:\\(|function|vi\\.fn|jest\\.fn|mock)|\\bfunc\\s+\\([^)]*\\)\\s*${m}\\s*\\(`).test(f.source);
    }),
  );
}

/** One seam, as a tester reads it. */
export function describeSeam(s: Seam): string {
  return (
    `- ${s.file} ${s.fn}(${s.params.join(", ")})\n` +
    s.objects
      .map((o) => `    ${o.from ? `${o.name} = ${o.from}` : o.name}: ${o.methods.map((m) => `${m}()`).join(", ")}`)
      .join("\n")
  );
}
