/**
 * Grounded derivation: one ask in, grounded nodes out. The round reads the
 * repository (read tools only) and returns nodes whose grounding names the
 * exact places each change lands — existing files as anchors, files yet to
 * be born as planned anchors. The host attaches stamps; the model never
 * fabricates currency.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AcceptanceCriterion, Anchor, Ask, Change, Question, validateAnchor } from "../core/schema";
import { readStamp, SourceStamp } from "../core/stamp";
import { RoundDeps, runReadRound } from "./round";
import { observationShaped } from "../run/observations";
import { downgradeUnreachable } from "./reachable";

/** A question the round could not settle from the code, with the machine's
 *  recommended answer — the human accepts or rewords; never left hanging. */
export interface DerivedQuestion {
  text: string;
  recommendation: string;
}

/** A derived node before ids and stamps are assigned by the host. */
export interface DerivedNode {
  sentence: string;
  touchpoints: Anchor[];
  /** Indices into THIS round's node list (a round derives a closed set). */
  needsIndices: number[];
  acceptance: Omit<AcceptanceCriterion, "id">[];
  /** 1-based number of the claim this change makes true, when the round
   *  was given claims to serve. */
  claim?: number;
  /** Effects the machine cannot verify, with the reason — notes, not checks. */
  unverified?: { text: string; why: string }[];
}

/** Build the derivation prompt. Pure; exported for tests. */
function buildGroundingPrompt(args: {
  ask: Ask;
  repoRoot: string;
  /** The structural map, extracted from the code: what is here and what
   *  hangs off what, with the file and line of every node. Fact — a round
   *  given this must not go looking for structure. */
  map?: string;
  /** The graph queried WITH THE ASK'S OWN WORDS — the structure nearest
   *  to what this ask names, where the generic map is about the repo at
   *  large. Keyword-matched: a lead to verify, not a verdict. */
  graphed?: string;
  /** Established repo reading, when current — spares re-discovery. */
  digest?: string;
  /** Decisions in force — accepted answers the round derives under. */
  decisions?: string[];
  /** Member scopes of a multirepo project open in this workspace. */
  scopes?: { id: string; dir: string; label?: string }[];
  /** The claims this grounding serves, numbered — each promise names one. */
  claims?: { text: string; why?: string }[];
}): string {
  return (
    `You are grounding ONE ask into the intended changes it implies.\n\n` +
    `THE ASK (the human's words — never rewrite them, only derive from them):\n` +
    `${args.ask.text}\n\n` +
    (args.map
      ? `YOUR CODE, AS IT IS (extracted from the code itself — every node ` +
        `carries its file and line). This is fact: do not re-derive it and ` +
        `do not search for structure you already have. Ground the promises ` +
        `on these paths, and read only the spans you must:\n${args.map}\n\n`
      : "") +
    (args.graphed
      ? `WHERE THE GRAPH LANDS THIS ASK (queried with the ask's own words — ` +
        `keyword-matched, so it is a lead to verify, not a verdict; every ` +
        `node carries its file and line):\n${args.graphed}\n\n`
      : "") +
    (args.digest
      ? `WHAT THE MAP CANNOT SHOW (conventions and the why — build under them):\n${args.digest}\n\n`
      : "") +
    `THE REPOSITORY is at ${args.repoRoot} — read what the grounding needs (Grep first, Read the spans that matter).\n\n` +
    (args.scopes?.length
      ? `THE PROJECT SPANS MORE THAN ONE REPOSITORY. Member scopes open in this workspace:\n${args.scopes
          .map((sc) => `- scope "${sc.id}"${sc.label ? ` (${sc.label})` : ""} at ${sc.dir}`)
          .join("\n")}\nA change landing in a member scope carries {"scope":"<scope id>"} on each of its touchpoints, with paths relative to THAT scope's root. A change never mixes scopes. Touchpoints without "scope" land in the main repository above.\n\n`
      : "") +
    `Return the intended CHANGES as nodes. For each node:\n` +
    `- "sentence": one plain sentence a person decides on — what this change is, in the ask's own register.\n` +
    (args.claims?.length
      ? `- "claim": the NUMBER of the claim this change makes true, from:\n` +
        args.claims
          .map((c, i) => `    ${i + 1}. ${c.text}${c.why ? ` (so that ${c.why})` : ""}`)
          .join("\n") +
        `\n  Every change must name exactly one. A change that serves none of ` +
        `them does not belong in this derivation.\n`
      : "") +
    `- "touchpoints": WHERE it lands: [{"path":"src/…","symbol":"functionOrSection",` +
    `"evidence":"one short sentence: what is at this place now, and why the change lands here"}]. ` +
    `Paths are repo-relative. A file that does not exist yet is a legitimate touchpoint — the change creates it, ` +
    `and its evidence says why THIS location. You have the file open while you decide — ` +
    `the evidence is that reading, written down so nobody re-reads the file to reconstruct it. ` +
    `NEVER put line numbers in a path; anchors are structural.\n` +
    `- "needs": indices (0-based, into this same list) of nodes that must be built first. Only real build-order edges.\n` +
    `- "acceptance": what proves this node done, as observable statements — at least one per node, ` +
    `each carrying its LIFETIME as "kind": [{"text":"…","kind":"probe"}].\n` +
    `    "probe" — STANDING BEHAVIOR: true today and still worth a machine checking in five years. Becomes a permanent regression test.\n` +
    `    "assessment" — proof of THIS TRANSITION: something is removed, renamed or reworded, documentation now says something. ` +
    `Judged once by an independent reviewer when the work is delivered, recorded on the delivery, and never kept as a test — ` +
    `a permanent test pinning prose or an absence fails every later change that legitimately moves on. ` +
    `A documentation-wording check is ALWAYS "assessment".\n` +
    `    A probe must name a seam a PLAIN TEST PROCESS CAN REACH: an exported function a test imports, or behavior ` +
    `observable through an injected fake. Judge reachability PER SEAM, and never bundle two seams in one check — ` +
    `a criterion naming two functions is TWO criteria. For a seam a test cannot reach (module-private, only behind ` +
    `the live host), prefer PLANNING THE SEAM: add a touchpoint and words to the node so the work exports one, and ` +
    `keep the check a probe against it; otherwise make that check an "assessment" (a reviewer reads the delivered ` +
    `code once), never a probe that no test can execute.\n` +
    `    A check OBSERVES THE CODE AT A SEAM — a call made, a request built, a state changed inside the program — ` +
    `through a fake where the real thing is the cluster, a service, a process, or anything outside the repository. ` +
    `A check NEVER PERFORMS the effect on the world. When the effect itself cannot be verified by the machine — it ` +
    `needs the running product, or acts on the world ("the cluster is down", "the app answers on its URL") — it is NOT ` +
    `a check: put it in the node's "unverified" list as {"text":"the effect","why":"why the machine cannot verify it"} ` +
    `and write the checks at the seam. The delivery reports each such effect as not verified, with its reason; nobody is ` +
    `assigned a check. Example — a button that shuts down the cluster: acceptance probe "pressing the button sends a ` +
    `shutdown request for the current cluster to the platform API, and only after a confirmation (seen through a fake ` +
    `API)"; probe "without confirmation no request is sent"; unverified {"text":"the cluster shuts down when the button ` +
    `is pressed","why":"acts on the cluster this runs in"}.\n` +
    `- "unverified": optional — the effects of this node the machine cannot verify, each {"text":"…","why":"…"}.\n` +
    (args.decisions?.length
      ? `DECISIONS IN FORCE (the human already settled these — derive consistently with them, never re-open them):\n${args.decisions.map((d) => `- ${d}`).join("\n")}\n\n`
      : "") +
    `Also return "questions": what the CODE CANNOT SETTLE — a real fork where the repo supports more than one reading of the ask. For each: {"text":"the question as the author would answer it","recommendation":"your recommended answer, concrete"}. ` +
    `Ambiguity is not yours to resolve silently and not the human's to be interrogated about mid-flow: raise it here WITH a recommended default. An unambiguous ask returns "questions":[] — that is the normal case.\n\n` +
    `Cut nodes where the CODE has seams, not where the prose has sentences: two intentions landing in the ` +
    `same file are ONE node. Most asks yield 1–5 nodes; returning fewer, sharper nodes beats returning many vague ones.\n\n` +
    `Respond with ONE JSON object {"nodes":[…],"questions":[…]} and nothing else.`
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
  scopeDir?: (scope: string) => string | undefined,
): DerivedNode[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: { nodes?: unknown; questions?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    return [];
  }
  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  void 0;
  const out: DerivedNode[] = [];
  for (const n of rawNodes) {
    if (typeof n !== "object" || n === null) continue;
    const rec = n as Record<string, unknown>;
    const sentence = typeof rec.sentence === "string" ? rec.sentence.trim() : "";
    if (!sentence) continue;
    const claim = typeof rec.claim === "number" ? rec.claim : undefined;
    const touchpoints: Anchor[] = [];
    for (const t of Array.isArray(rec.touchpoints) ? rec.touchpoints : []) {
      if (typeof t !== "object" || t === null) continue;
      const a = t as Record<string, unknown>;
      const anchor: Anchor = {
        path: typeof a.path === "string" ? a.path.trim() : "",
        ...(typeof a.symbol === "string" && a.symbol.trim()
          ? { symbol: a.symbol.trim() }
          : {}),
        ...(typeof a.evidence === "string" && a.evidence.trim()
          ? { evidence: a.evidence.trim().slice(0, 240) }
          : {}),
        ...(typeof a.scope === "string" && a.scope.trim() && scopeDir?.(a.scope.trim())
          ? { scope: a.scope.trim() }
          : {}),
      };
      if (validateAnchor(anchor)) continue;
      const root = anchor.scope ? (scopeDir?.(anchor.scope) ?? repoRoot) : repoRoot;
      if (!fileExists(path.join(root, anchor.path))) anchor.planned = true;
      touchpoints.push(anchor);
    }
    const needsIndices = (Array.isArray(rec.needs) ? rec.needs : [])
      .filter((i): i is number => Number.isInteger(i) && (i as number) >= 0)
      .filter((i) => i < rawNodes.length);
    const acceptance = (Array.isArray(rec.acceptance) ? rec.acceptance : [])
      .map((c) => {
        if (typeof c !== "object" || c === null) return { text: "" };
        const a = c as Record<string, unknown>;
        return {
          text: typeof a.text === "string" ? a.text.trim() : "",
          // Only the transition kind is recorded; standing behavior is the
          // default and an unknown kind must not invent a lifetime.
          ...(a.kind === "assessment" ? { kind: "assessment" as const } : {}),
        };
      })
      .filter((c) => c.text.length > 0);
    // Effects the machine cannot verify are notes on the node, never checks:
    // each carries the reason, bounded, and an entry with no reason is dropped.
    const unverified = (Array.isArray(rec.unverified) ? rec.unverified : [])
      .map((u) => (typeof u === "object" && u !== null ? (u as Record<string, unknown>) : {}))
      .map((u) => ({
        text: typeof u.text === "string" ? u.text.trim().slice(0, 300) : "",
        why: typeof u.why === "string" ? u.why.trim().slice(0, 200) : "",
      }))
      .filter((u) => u.text && u.why);
    // The prompt above states the rule; this enforces it. A criterion the
    // model worded as a check that only the running product can show is
    // moved to the unverified notes AT BIRTH — an instruction asks, the
    // parser guarantees. One such criterion reached a signed cut and no
    // gate could then be honest about it: red withheld the delivery the
    // observation needed, green claimed somebody saw what nobody saw.
    const observed = acceptance.filter((c) => observationShaped(c.text));
    const checks = acceptance.filter((c) => !observationShaped(c.text));
    for (const c of observed)
      unverified.push({ text: c.text.slice(0, 300), why: "only the running product can show it — the person certifies it on the delivery" });
    out.push({
      sentence,
      touchpoints,
      needsIndices,
      acceptance: checks,
      ...(claim ? { claim } : {}),
      ...(unverified.length ? { unverified } : {}),
    });
  }
  return out;
}

/** Parse the round's unresolved questions (fail-soft to none). */
export function parseGroundedQuestions(raw: string): DerivedQuestion[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: { questions?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    return [];
  }
  const out: DerivedQuestion[] = [];
  for (const q of Array.isArray(parsed.questions) ? parsed.questions : []) {
    if (typeof q !== "object" || q === null) continue;
    const rec = q as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    const recommendation =
      typeof rec.recommendation === "string" ? rec.recommendation.trim() : "";
    if (text && recommendation) out.push({ text, recommendation });
  }
  return out;
}

export interface GroundingResult {
  changes: Change[];
  questions: Omit<Question, "id">[];
}

/**
 * Run the grounding round end to end: prompt, round, parse, stamp, resolve.
 * Empty on any failure — the ask stays captured and can be re-grounded.
 */
export async function runGrounding(
  deps: RoundDeps,
  ask: Ask,
  opts: {
    map?: string;
    graphed?: string;
    digest?: string;
    nextIndex: number;
    decisions?: string[];
    mintId?: (n: number) => string;
    /** The claims this grounding serves; each promise names one. */
    claims?: { id: string; text: string; why?: string }[];
    scopes?: { id: string; dir: string; label?: string }[];
  },
  round: (deps: RoundDeps, prompt: string) => Promise<string | null> = runReadRound,
): Promise<GroundingResult> {
  const text = await round(
    deps,
    buildGroundingPrompt({
      ...(opts.claims ? { claims: opts.claims } : {}),
      ask,
      repoRoot: deps.repoRoot,
      digest: opts.digest,
      ...(opts.map ? { map: opts.map } : {}),
      ...(opts.graphed ? { graphed: opts.graphed } : {}),
      decisions: opts.decisions,
      scopes: opts.scopes,
    }),
  );
  if (text === null) return { changes: [], questions: [] };
  const derived = parseGroundedNodes(
    text,
    deps.repoRoot,
    undefined,
    (sc) => opts.scopes?.find((x) => x.id === sc)?.dir,
  );
  // The mechanical look behind the model's testability judgement: a probe
  // naming a symbol its touchpoints hold unexported becomes an assessment.
  downgradeUnreachable(derived, deps.repoRoot, deps.log);
  const questions = parseGroundedQuestions(text).map((q) => ({
    askId: ask.id,
    text: q.text,
    recommendation: q.recommendation,
  }));
  if (derived.length === 0) return { changes: [], questions };
  const stamp = [await readStamp(deps.repoRoot)];
  return {
    changes: resolveDerived(
      derived,
      ask.id,
      stamp,
      opts.nextIndex,
      opts.mintId,
      opts.claims?.map((c) => c.id),
    ),
    questions,
  };
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
  mintId?: (n: number) => string,
  /** Claim ids in the order the prompt numbered them. */
  claimIds?: string[],
): Change[] {
  const ids = derived.map((_, i) => (mintId ? mintId(nextIndex + i) : `node-${nextIndex + i}`));
  return derived.map((d, i) => ({
    id: ids[i],
    sentence: d.sentence,
    serves: [askId],
    needs: d.needsIndices.filter((n) => n !== i).map((n) => ids[n]),
    ...(d.touchpoints.length
      ? { grounding: { touchpoints: d.touchpoints, stamp } }
      : {}),
    ...(d.claim && claimIds?.[d.claim - 1] ? { servesClaim: claimIds[d.claim - 1] } : {}),
    acceptance: d.acceptance.map((c, j) => ({ id: `${ids[i]}-check-${j + 1}`, ...c })),
    ...(d.unverified?.length ? { unverified: d.unverified } : {}),
  }));
}
