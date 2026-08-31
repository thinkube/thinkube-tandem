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
import { factsOf } from "../run/facts";
import { downstreamOf } from "../run/survey";
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
/** Where this target settles what a worktree cannot — one sentence per
 *  downstream, given to the grounding so it classifies instead of forcing
 *  every criterion into a here-shaped check. */
function settlingSourceOf(downstream: string): string | undefined {
  switch (downstream) {
    case "gitops-app":
      return "the app's build pipeline — its declared tests run in their named image after the merge, and a failure prevents deployment";
    case "template":
      return "a validation deployment of the template through thinkube-control";
    case "ansible":
    case "ansible-component":
      return "the component's own 18_test.yaml, run against the live cluster after deployment";
    case "package":
      return "a person installing the package on a clean machine (attested on the delivery)";
    default:
      return undefined;
  }
}

function buildGroundingPrompt(args: {
  ask: Ask;
  repoRoot: string;
  settling?: string;
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
    `  — when the node INTRODUCES or CHANGES a function, "symbol" carries its SIGNATURE, ` +
    `e.g. "pushActive(key: string, message: string): void": the checks and the code are both ` +
    `written to that one seam, and a bare name makes each side guess a shape —` +
    `"evidence":"one short sentence: what is at this place now, and why the change lands here"}]. ` +
    `Paths are repo-relative. A file that does not exist yet is a legitimate touchpoint — the change creates it, ` +
    `and its evidence says why THIS location. You have the file open while you decide — ` +
    `the evidence is that reading, written down so nobody re-reads the file to reconstruct it. ` +
    `NEVER put line numbers in a path; anchors are structural.\n` +
    `- "needs": indices (0-based, into this same list) of nodes that must be built first. Only real build-order edges.\n` +
    `- "acceptance": what proves this node done, as observable statements — at least one per node, ` +
    `each stating the PROPERTY the person wants to hold, never the way a check would look for it. ` +
    `Write what must be true of the product, not what a test does: "no instruction on the surface names a page ` +
    `that does not exist" — never "the handle appears literally in the source, reading the source files, not the ` +
    `built bundle", and never "the repository's existing check, run unchanged". A criterion that names a check, ` +
    `a file to read, or a way of reading it has descended to the level of its own proof: the method is then frozen ` +
    `into what was signed, no worker may change how it is proved, and the delivery is withheld for the criterion ` +
    `contradicting another rule of the run rather than for the work being wrong. ` +
    `each carrying its LIFETIME as "kind": [{"text":"…","kind":"probe"}].\n` +
    `    "probe" — STANDING BEHAVIOR: true today and still worth a machine checking in five years. Becomes a permanent regression test.\n` +
    `    "assessment" — proof of THIS TRANSITION: something is removed, renamed or reworded, documentation now says something. ` +
    `Judged once by an independent reviewer when the work is delivered, recorded on the delivery, and never kept as a test — ` +
    `a permanent test pinning prose or an absence fails every later change that legitimately moves on. ` +
    `A documentation-wording check is ALWAYS "assessment".\n` +
    `    A RENDERED PAGE IS SUCH A SEAM. The surface is built, opened in a browser and measured through the DOM ` +
    `(src/gates/renderedSurface.ts), so a criterion about what a PERSON SEES — a page can be seen, a control is ` +
    `present and can be pressed, a mark survives at a distance, a word appears where it is read — is a PROBE against ` +
    `the rendered product. Never an assessment, never "unverified". Nineteen asks about a surface became assertions ` +
    `about the text of source files because this seam was not named here: every one of them was true of a window in ` +
    `which every page was laid out at zero height, and the delivery went out green.\n` +
    `    A probe must name a seam a PLAIN TEST PROCESS CAN REACH: an exported function a test imports, behavior ` +
    `observable through an injected fake, or the rendered surface. Judge reachability PER SEAM, and never bundle two seams in one check — ` +
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
    `    A check may require WHAT THIS WORK CHANGES, or what the running product does. It may NEVER require that something the work does not touch agrees with something it does — a generated file matching its source, a built copy matching what it was built from, one repository agreeing with another. Nobody in the run is cleared to change the other side, so no order of work makes such a check true, and it is judged red at the end for a reason no worker could have acted on. Check what the SOURCE says.\n` +
    `- "unverified": optional — the effects of this node the machine cannot verify, each {"text":"…","why":"…"}.\n` +
    (args.settling
      ? `    THIS TARGET IS SETTLED ELSEWHERE for behaviour a worktree cannot run: ${args.settling}. ` +
        `A criterion about behaviour THAT SOURCE will actually exercise gets "settledBy": "<that source, in a few words>" ` +
        `instead of a probe or an unverified entry — it rides the delivery as pending and is answered from there ` +
        `after the merge. Logic a plain test process CAN reach here stays a probe; an effect NOTHING mechanical ` +
        `settles stays "unverified". Never force a deployed-behaviour criterion into a here-shaped check: it fails ` +
        `for the machine's limits and blames the work.\n`
      : "") +
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
          ...(typeof (a as { settledBy?: unknown }).settledBy === "string" &&
          ((a as { settledBy: string }).settledBy = (a as { settledBy: string }).settledBy.trim())
            ? { settledBy: (a as { settledBy: string }).settledBy.slice(0, 200) }
            : {}),
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
    const observed = acceptance.filter((c) => !c.settledBy && observationShaped(c.text));
    const checks = acceptance.filter((c) => c.settledBy || !observationShaped(c.text));
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
/** A function named by a bare identifier — a name, not a seam. */
const BARE_FUNCTION = /^[a-z_$][\w$]*$/;

/**
 * Ask for the signature of every function a node introduces or changes
 * and named only by its bare name. One bounded round over the tree, for
 * exactly those symbols; what it cannot shape stays a bare name and is
 * said in the log, so the gap is on the record rather than in a guess.
 *
 * The signature is shaped WITH the criteria that will judge it. A shape
 * invented from the sentence alone can be narrower than the criteria
 * demand — a type of five values under a criterion naming six states —
 * and the coder is then held to a contract no correct implementation can
 * satisfy: its checks fail for a reason no code can fix, and the
 * impossibility reaches the person as an unkept promise.
 */
async function shapeSeams(
  derived: DerivedNode[],
  deps: RoundDeps,
  round: (deps: RoundDeps, prompt: string) => Promise<string | null>,
): Promise<void> {
  const bare = derived.flatMap((n) =>
    n.touchpoints.filter((t) => t.symbol && BARE_FUNCTION.test(t.symbol)).map((t) => ({ node: n, t })),
  );
  if (!bare.length) return;
  const listed = bare.map(({ node, t }, i) =>
    [
      `${i + 1}. ${t.path} › ${t.symbol} — for: "${node.sentence}"${t.planned ? " (new)" : " (exists, changed)"}`,
      ...node.acceptance
        .map((ac) => ac.text.trim())
        .filter(Boolean)
        .map((text) => `   must satisfy: ${text}`),
    ].join("\n"),
  );
  const reply = await round(
    { ...deps, maxTurns: 16 },
    [
      "You are completing the CONTRACT of a change before any worker starts. Each line below names a",
      "function a promise introduces or changes, by name only. A name is not a seam: the tester writes",
      "checks to a shape and the coder builds to a shape, and if the contract does not state one, each",
      "guesses and the checks never compile against the code.",
      "",
      "For EACH line, state the function's SIGNATURE as it will be after the change — parameters with",
      "types, and the return type — reading the file and its callers in this repository to keep every",
      "existing caller compiling (an optional parameter, an overload, a default) unless the promise",
      "itself requires breaking one. Write the signature, not a description.",
      "",
      "The criteria under each line are what the finished work is judged by, and this signature is",
      "binding on the worker that must meet them. So the shape must be able to satisfy them: a type",
      "that enumerates its values must hold every value the criteria name — a criterion naming six",
      "distinct states needs a type of six, not five. A signature narrower than its criteria cannot",
      "be met by any correct implementation, and the worker pays for it.",
      "",
      listed.join("\n"),
      "",
      "Respond with EXACTLY one line per number and nothing else:",
      "<number>: <signature, e.g. pushActive(key: string, message: string): void>",
    ].join("\n"),
  ).catch(() => null);
  const shaped = new Map<number, string>();
  for (const l of (reply ?? "").split("\n")) {
    const m = /^\s*(\d+)\s*:\s*(.+?)\s*$/.exec(l);
    if (m && m[2].includes("(")) shaped.set(Number(m[1]), m[2].replace(/^`+|`+$/g, ""));
  }
  bare.forEach(({ t }, i) => {
    const sig = shaped.get(i + 1);
    if (sig) t.symbol = sig;
    else deps.log?.(`⚠ the contract still names ${t.path} › ${t.symbol} without its shape — a gap the checks and the code will meet`);
  });
}

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
      ...((): { settling?: string } => {
        // The target's kind, remembered or freshly surveyed — the settling
        // source follows from it, and the classification above depends on
        // knowing it.
        const down = factsOf(deps.repoRoot)?.downstream ?? downstreamOf(deps.repoRoot);
        const settling = settlingSourceOf(down);
        return settling ? { settling } : {};
      })(),
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
  // A seam named without its shape is the machine's gap to fill, here,
  // before anything is sliced: the tester and the coder are written to one
  // signature, never to two guesses, and the person is never asked.
  await shapeSeams(derived, deps, round);
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
