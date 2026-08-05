/**
 * Grounded derivation: one ask in, grounded nodes out. The round reads the
 * repository (read tools only) and returns nodes whose grounding names the
 * exact places each change lands — existing files as anchors, files yet to
 * be born as planned anchors. The host attaches stamps; the model never
 * fabricates currency.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Anchor, Ask, ChangeNode, Check, validateAnchor } from "../core/schema";
import { readStamp, SourceStamp } from "../core/stamp";
import { RoundDeps, runReadRound } from "./round";

/** A derived node before ids and stamps are assigned by the host. */
export interface DerivedNode {
  sentence: string;
  touchpoints: Anchor[];
  /** Indices into THIS round's node list (a round derives a closed set). */
  needsIndices: number[];
  checks: Omit<Check, "id">[];
}

/** Build the derivation prompt. Pure; exported for tests. */
export function buildGroundingPrompt(args: {
  ask: Ask;
  repoRoot: string;
  /** Established repo reading, when current — spares re-discovery. */
  digest?: string;
}): string {
  return (
    `You are grounding ONE ask into the intended changes it implies.\n\n` +
    `THE ASK (the human's words — never rewrite them, only derive from them):\n` +
    `${args.ask.text}\n\n` +
    (args.digest
      ? `WHAT THE CODE LOOKS LIKE (established reading — build on it, read only what it lacks):\n${args.digest}\n\n`
      : "") +
    `THE REPOSITORY is at ${args.repoRoot} — read what the grounding needs (Grep first, Read the spans that matter).\n\n` +
    `Return the intended CHANGES as nodes. For each node:\n` +
    `- "sentence": one plain sentence a person decides on — what this change is, in the ask's own register.\n` +
    `- "touchpoints": WHERE it lands: [{"path":"src/…","symbol":"functionOrSection"}]. ` +
    `Paths are repo-relative. A file that does not exist yet is a legitimate touchpoint — the change creates it. ` +
    `NEVER put line numbers in a path; anchors are structural.\n` +
    `- "needs": indices (0-based, into this same list) of nodes that must be built first. Only real build-order edges.\n` +
    `- "checks": what proves this node done, as observable statements: [{"text":"…"}]. At least one per node.\n\n` +
    `Cut nodes where the CODE has seams, not where the prose has sentences: two intentions landing in the ` +
    `same file are ONE node. Most asks yield 1–5 nodes; returning fewer, sharper nodes beats returning many vague ones.\n\n` +
    `Respond with ONE JSON object {"nodes":[{"sentence":"…","touchpoints":[…],"needs":[…],"checks":[…]}]} and nothing else.`
  );
}

/**
 * Parse and validate a round's output. Anchors are validated (positions
 * refused), needs indices bounded, empty sentences dropped. `fileExists`
 * marks planned anchors; injectable for tests.
 */
export function parseGroundedNodes(
  raw: string,
  repoRoot: string,
  fileExists: (abs: string) => boolean = fs.existsSync,
): DerivedNode[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: { nodes?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    return [];
  }
  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const out: DerivedNode[] = [];
  for (const n of rawNodes) {
    if (typeof n !== "object" || n === null) continue;
    const rec = n as Record<string, unknown>;
    const sentence = typeof rec.sentence === "string" ? rec.sentence.trim() : "";
    if (!sentence) continue;
    const touchpoints: Anchor[] = [];
    for (const t of Array.isArray(rec.touchpoints) ? rec.touchpoints : []) {
      if (typeof t !== "object" || t === null) continue;
      const a = t as Record<string, unknown>;
      const anchor: Anchor = {
        path: typeof a.path === "string" ? a.path.trim() : "",
        ...(typeof a.symbol === "string" && a.symbol.trim()
          ? { symbol: a.symbol.trim() }
          : {}),
      };
      if (validateAnchor(anchor)) continue;
      if (!fileExists(path.join(repoRoot, anchor.path))) anchor.planned = true;
      touchpoints.push(anchor);
    }
    const needsIndices = (Array.isArray(rec.needs) ? rec.needs : [])
      .filter((i): i is number => Number.isInteger(i) && (i as number) >= 0)
      .filter((i) => i < rawNodes.length);
    const checks = (Array.isArray(rec.checks) ? rec.checks : [])
      .map((c) =>
        typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).text === "string"
          ? { text: ((c as Record<string, unknown>).text as string).trim() }
          : { text: "" },
      )
      .filter((c) => c.text.length > 0);
    out.push({ sentence, touchpoints, needsIndices, checks });
  }
  return out;
}

/**
 * Run the grounding round end to end: prompt, round, parse, stamp, resolve.
 * Empty on any failure — the ask stays captured and can be re-grounded.
 */
export async function runGrounding(
  deps: RoundDeps,
  ask: Ask,
  opts: { digest?: string; nextIndex: number },
): Promise<ChangeNode[]> {
  const text = await runReadRound(
    deps,
    buildGroundingPrompt({ ask, repoRoot: deps.repoRoot, digest: opts.digest }),
  );
  if (text === null) return [];
  const derived = parseGroundedNodes(text, deps.repoRoot);
  if (derived.length === 0) return [];
  const stamp = [await readStamp(deps.repoRoot)];
  return resolveDerived(derived, ask.id, stamp, opts.nextIndex);
}

/**
 * Resolve a derived batch into ChangeNodes: assign ids, rewrite needs
 * indices to node ids, attach the round's stamp to every grounded node.
 */
export function resolveDerived(
  derived: DerivedNode[],
  askId: string,
  stamp: SourceStamp[],
  nextIndex: number,
): ChangeNode[] {
  const ids = derived.map((_, i) => `node-${nextIndex + i}`);
  return derived.map((d, i) => ({
    id: ids[i],
    sentence: d.sentence,
    serves: [askId],
    needs: d.needsIndices.filter((n) => n !== i).map((n) => ids[n]),
    ...(d.touchpoints.length
      ? { grounding: { touchpoints: d.touchpoints, stamp } }
      : {}),
    checks: d.checks.map((c, j) => ({ id: `${ids[i]}-check-${j + 1}`, ...c })),
  }));
}
