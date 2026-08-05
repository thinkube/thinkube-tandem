/**
 * Anchor resolution at dispatch: anchors are structural; line numbers are
 * rendered here, against the exact worktree a worker will receive, at the
 * moment the brief is assembled. An anchor that no longer resolves is a
 * plan problem — the dispatch refuses and says which premise broke; the
 * worker never guesses at a moved target.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Anchor } from "../core/schema";

export type ResolvedAnchor =
  | { ok: true; anchor: Anchor; line: number; planned?: undefined }
  | { ok: true; anchor: Anchor; planned: true; line?: undefined }
  | { ok: false; anchor: Anchor; reason: string };

export function resolveAnchor(
  worktree: string,
  anchor: Anchor,
  readFile: (abs: string) => string | undefined = (abs) => {
    try {
      return fs.readFileSync(abs, "utf8");
    } catch {
      return undefined;
    }
  },
): ResolvedAnchor {
  const abs = path.join(worktree, anchor.path);
  const text = readFile(abs);
  if (text === undefined) {
    if (anchor.planned) return { ok: true, anchor, planned: true };
    return {
      ok: false,
      anchor,
      reason: `${anchor.path} does not exist in the worktree`,
    };
  }
  if (!anchor.symbol) return { ok: true, anchor, line: 1 };
  const lines = text.split("\n");
  const symbol = anchor.symbol;
  const declaration = new RegExp(
    `\\b(function|class|interface|type|const|let|var|def|case)\\b[^\\n]*\\b${escapeRegExp(symbol)}\\b|\\b${escapeRegExp(symbol)}\\b\\s*[:=(]`,
  );
  for (let i = 0; i < lines.length; i++)
    if (declaration.test(lines[i])) return { ok: true, anchor, line: i + 1 };
  for (let i = 0; i < lines.length; i++)
    if (lines[i].includes(symbol)) return { ok: true, anchor, line: i + 1 };
  return {
    ok: false,
    anchor,
    reason: `symbol '${symbol}' no longer exists in ${anchor.path}`,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
