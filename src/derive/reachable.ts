/**
 * The mechanical look behind the grounding's testability judgement: a probe
 * that names a symbol its touchpoint files hold but never export is a probe
 * no plain test process can execute. It is downgraded to an assessment — a
 * reviewer reads the delivered code once — and the downgrade is said. The
 * model decides first (split per seam, plan a seam, assess); this audit only
 * catches what slipped.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** `identifier`-shaped names the check's own words carry. */
export function namedSymbols(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)(?:\(\))?`/g)) out.add(m[1]);
  // Bare camelCase call-shaped names ("ensureSession(...)") count too.
  for (const m of text.matchAll(/\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s*\(/g)) out.add(m[1]);
  return [...out];
}

/** Whether a source file exports the symbol, by the common forms. */
export function exportsSymbol(source: string, symbol: string): boolean {
  const s = symbol.replace(/[$]/g, "\\$&");
  return (
    new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${s}\\b`).test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`).test(source) ||
    new RegExp(`exports\\.${s}\\s*=`).test(source) ||
    new RegExp(`module\\.exports\\s*=\\s*\\{[^}]*\\b${s}\\b`).test(source)
  );
}

export interface ReachabilityFlag {
  criterionText: string;
  symbol: string;
  file: string;
}

/**
 * Audit one node's probe-kind checks against its touchpoint files: a check
 * naming a symbol that lives in a touchpoint without being exported from it
 * is flagged. A symbol not found at all is NOT flagged — the file may be
 * planned, the name may be prose.
 */
export function auditProbeReachability(
  node: {
    acceptance: { text: string; kind?: string }[];
    touchpoints?: { path: string; planned?: boolean }[];
  },
  repoRoot: string,
  scopeDir?: (scope: string) => string | undefined,
): ReachabilityFlag[] {
  void scopeDir;
  const flags: ReachabilityFlag[] = [];
  const sources = (node.touchpoints ?? [])
    .filter((t) => !t.planned)
    .map((t) => {
      try {
        return { file: t.path, source: fs.readFileSync(path.join(repoRoot, t.path), "utf8") };
      } catch {
        return undefined;
      }
    })
    .filter((x): x is { file: string; source: string } => !!x);
  for (const c of node.acceptance) {
    if (c.kind === "assessment") continue;
    for (const sym of namedSymbols(c.text)) {
      const holder = sources.find((f) => new RegExp(`\\b(?:function|const|let|var|class)\\s+${sym}\\b`).test(f.source));
      if (holder && !exportsSymbol(holder.source, sym)) flags.push({ criterionText: c.text, symbol: sym, file: holder.file });
    }
  }
  return flags;
}

/**
 * Apply the audit to freshly parsed nodes: each flagged probe becomes an
 * assessment, and the downgrade is reported so the reader sees it on the
 * work page's own terms (the reviewer will judge it; no test can reach it).
 */
export function downgradeUnreachable(
  nodes: readonly {
    acceptance: { text: string; kind?: string }[];
    touchpoints?: { path: string; planned?: boolean }[];
  }[],
  repoRoot: string,
  say?: (line: string) => void,
): number {
  let downgraded = 0;
  for (const n of nodes) {
    for (const f of auditProbeReachability(n, repoRoot)) {
      const c = n.acceptance.find((x) => x.text === f.criterionText && x.kind !== "assessment");
      if (!c) continue;
      (c as { kind?: string }).kind = "assessment";
      downgraded++;
      say?.(
        `check "${f.criterionText.slice(0, 80)}" names \`${f.symbol}\`, which ${f.file} holds but does not export — no test can reach it, so it is judged by a reviewer at delivery instead`,
      );
    }
  }
  return downgraded;
}
