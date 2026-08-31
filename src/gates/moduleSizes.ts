/**
 * The shape of a repository's modules, reported and never enforced.
 *
 * A ceiling on file length can be satisfied by deleting the explanation
 * instead of extracting the code — the cheaper move and the worse one, and
 * the one that gets taken. Measured against the tree it governed, a limit of
 * six hundred lines moved little: the median module is about a hundred lines
 * of code with or without it, and the largest files sit in the directory it
 * exempted.
 *
 * So the shape is measured and said, and what it means is the person's to
 * judge. Code and comments are counted apart, because a file of five hundred
 * lines that is half explanation is not the same object as one that is not.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface ModuleSize {
  path: string;
  /** Lines that are neither blank nor comment. */
  code: number;
  total: number;
}

export interface TreeShape {
  files: number;
  code: { max: number; median: number; mean: number; min: number };
  /** The largest few, by code — the only ones anyone acts on. */
  largest: ModuleSize[];
  /** Share of all lines that explain rather than instruct, as a percentage. */
  explained: number;
}

/** One file's size, blank lines and comments not counted as code. */
function measure(rel: string, source: string): ModuleSize {
  const lines = source.split("\n");
  let code = 0;
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
      continue;
    }
    code++;
  }
  return { path: rel, code, total: lines.length };
}

const SOURCE = /\.(m|c)?[jt]sx?$|\.(py|go|rs|rb|java|kt|php|cs|swift|scala)$/i;
const SKIP = new Set([
  "node_modules", ".git", "out", "out-test", "dist", "media", "build", "target", "venv", ".venv", "vendor",
]);

/** Every source file of a tree; checks answer for their own size. */
async function walk(root: string, at = "", found: ModuleSize[] = []): Promise<ModuleSize[]> {
  const here = await fs.readdir(path.join(root, at), { withFileTypes: true }).catch(() => []);
  for (const entry of here) {
    const rel = at ? `${at}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) await walk(root, rel, found);
      continue;
    }
    if (!SOURCE.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
    const text = await fs.readFile(path.join(root, rel), "utf8").catch(() => undefined);
    if (text !== undefined) found.push(measure(rel, text));
  }
  return found;
}

const middle = (ns: readonly number[]): number =>
  ns.length === 0
    ? 0
    : ns.length % 2
      ? ns[(ns.length - 1) / 2]
      : Math.round((ns[ns.length / 2 - 1] + ns[ns.length / 2]) / 2);

export async function treeShape(root: string, largest = 5): Promise<TreeShape | undefined> {
  const files = await walk(root);
  if (!files.length) return undefined;
  const code = files.map((f) => f.code).sort((a, b) => a - b);
  const totalLines = files.reduce((n, f) => n + f.total, 0);
  const codeLines = files.reduce((n, f) => n + f.code, 0);
  return {
    files: files.length,
    code: { max: code[code.length - 1], median: middle(code), mean: Math.round(codeLines / files.length), min: code[0] },
    largest: [...files].sort((a, b) => b.code - a.code).slice(0, largest),
    explained: totalLines ? Math.round(((totalLines - codeLines) / totalLines) * 100) : 0,
  };
}

/** The shape as a person reads it — a paragraph and a short list, never a verdict. */
export function sayShape(s: TreeShape): string[] {
  return [
    "",
    "## The shape of the modules",
    "",
    `${s.files} source files. Lines of code per file — largest ${s.code.max}, median ${s.code.median}, ` +
      `average ${s.code.mean}, smallest ${s.code.min}. ${s.explained}% of all lines explain rather than instruct.`,
    "",
    "Nothing here is a rule; a file holds one nameable thing, and that is a reading, not a count.",
    "",
    ...s.largest.map((f) => `- ${f.path} — ${f.code} lines of code, ${f.total} in all`),
  ];
}
