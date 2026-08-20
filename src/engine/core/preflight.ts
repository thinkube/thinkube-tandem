import { loadTemplate } from "../promptTemplates";
import { BUNDLED_WORKER_PREAMBLE, UNDELIVERED_FORMAT_STANZA, stripSatisfies } from "./redispatch";
import { SchedUnit } from "./dag";
import { WorkUnit } from "./base";
// ── RUN PREFLIGHT provisions (context tranche, 2026-07-14 — the pure half) ─────
//
// Workers were starved: prompts dispatched with an unresolvable TEP, an empty spec body,
// a multi-unit slice with no contract, a unit with no note — and the starvation surfaced
// only as a red gate rounds later, at full token cost. This pure check names every missing
// provision BEFORE any worker dispatches; the shell's instruments half (dispatcher smoke,
// harness smoke, store writability) is I/O and lives in `OrchestratorService.defaultPreflight`.

/** One about-to-dispatch unit as the provisions check sees it. */
export interface PreflightUnit {
  id: string;
  slice: string;
  /** The unit's task note (concatenated from its work units). */
  note?: string;
  footprint: string[];
  /** True when the slice authored `work_units` (a legacy files-only slice has no
   *  authored note to starve, so the note check does not apply to it). */
  hasAuthoredUnits: boolean;
  /** True when the slice declares MORE THAN ONE work unit — those units coordinate
   *  through the slice contract, so a missing contract starves them all. */
  multiUnitSlice: boolean;
  /** The slice's declared contract (NOT the spec-wide union — the check is per slice). */
  sliceContract?: string;
}

/**
 * The provisions half of the RUN PREFLIGHT: verify every about-to-dispatch unit's prompt
 * inputs resolve NON-EMPTY — the parent TEP body (via the spec's `implements`), the spec
 * body, the slice contract for multi-unit slices, the unit note, and a non-empty footprint.
 * Returns one human-readable failure line per missing piece (empty = provisioned). Pure.
 */
export function preflightProvisionFailures(input: {
  specBody: string;
  tepBody: string;
  /** The spec frontmatter's `implements` value, for the failure message. */
  implementsRef?: unknown;
  units: PreflightUnit[];
}): string[] {
  const failures: string[] = [];
  if (!input.specBody.trim())
    failures.push(
      "spec body is empty — the spec doc could not be read (or has no content); every worker prompt embeds it.",
    );
  if (!input.tepBody.trim())
    failures.push(
      `parent TEP body unresolvable (spec frontmatter implements: ${
        typeof input.implementsRef === "string" && input.implementsRef.trim()
          ? JSON.stringify(input.implementsRef)
          : "unset"
      }) — worker prompts thread the TEP as the north star; fix the spec's \`implements\` or the TEP file.`,
    );
  const contractFlagged = new Set<string>();
  for (const u of input.units) {
    if (!(u.footprint ?? []).filter((f) => f.trim()).length)
      failures.push(
        `${u.id} (${u.slice}): no declared footprint — the unit has nowhere to write.`,
      );
    if (u.hasAuthoredUnits && !(u.note ?? "").trim())
      failures.push(
        `${u.id} (${u.slice}): unit note is empty — the worker would dispatch with no task text.`,
      );
    if (
      u.multiUnitSlice &&
      !(u.sliceContract ?? "").trim() &&
      !contractFlagged.has(u.slice)
    ) {
      contractFlagged.add(u.slice);
      failures.push(
        `${u.slice}: multi-unit slice has no \`contract\` — its units would each invent the shared interface.`,
      );
    }
  }
  return failures;
}

export function buildWorkerPrompt(
  unit: SchedUnit,
  specNumber: string,
  context?: {
    specBody?: string;
    sliceBody?: string;
    testConvention?: string;
    /** SP-12: the repo-declared, non-mutating build-and-test command a CODE-author runs to
     *  self-verify (read from `.tandem/conventions.json`'s top-level `selfVerify`). Rendered as the
     *  VERIFICATION BLOCK for code units when set; omitted entirely (block + `SELF-VERIFY` marker)
     *  when absent/blank. A test unit renders none of the SP-12 blocks. Ignored when
     *  {@link oracleAvailable} is set — the oracle replaces the self-run command. */
    selfVerifyCommand?: string;
    /** Tests-first (2026-07-08): the black-box verify oracle is wired for this code unit. The
     *  VERIFICATION BLOCK then instructs the worker to verify EXCLUSIVELY via the `verify` tool
     *  (never running builds/tests itself), and the prohibitions extend to every test file. */
    oracleAvailable?: boolean;
    /** SP-6/16 Part A: the repo's canonical example test CONTENT — the file declared as a repo-relative
     *  `testExample` in `.tandem/conventions.json`, its content read by `defaultAcceptanceRecipeResolver`.
     *  Rendered VERBATIM under the `EXAMPLE TEST` marker into a `role: "test"` prompt ONLY; omitted
     *  entirely (block + marker) when absent/blank, and NEVER rendered for a code unit. */
    exampleTest?: string;
    /** Full-intention threading (context tranche, 2026-07-14): the parent TEP body, rendered
     *  VERBATIM for BOTH roles as "THE INTENT — the north star". Workers were starved of the
     *  why behind their slice; the TEP is the artifact that carries it. */
    tepBody?: string;
    /** Full-intention threading: every SIBLING execution unit's `note`, labeled by the note's
     *  author role, so a code worker knows what the test-author will assert and a test worker
     *  knows what the code-author plans. The orchestrator passes every OTHER unit of the run. */
    siblingNotes?: {
      unit: string;
      slice: string;
      role: "code" | "test";
      note: string;
    }[];
    /** Orientation (2026-07-15): the worker's absolute cwd — stated up front so no
     *  worker ever guesses its own checkout path or ls-walks the tree to orient. */
    cwd?: string;
    /** Retirement carve-out (2026-07-15): test paths this unit's footprint owns for
     *  DELETION (other specs' obsolete probes) — named in the lane text so the prose
     *  never contradicts the fence that allows exactly these. */
    retiredTestFiles?: string[];
    /** Provisioned footprint contents (2026-07-15, speed): the CURRENT content of the
     *  unit's existing footprint files at dispatch, so the coder starts with its files
     *  in context instead of a serial read phase. Characters are cheap; round trips
     *  are the latency. Truncated/omitted files carry a marker instead of content. */
    footprintFiles?: { path: string; content: string; omitted?: string }[];
    /** Deterministic graph orientation (bounded query-plan output over the
     *  repo's cached knowledge graph): who imports the footprint, what the
     *  seams connect to — so a worker starts oriented instead of grepping
     *  cold. Advisory map; the repo is the authority. */
    graphOrientation?: string;
  },
): string {
  const fp = unit.footprint.join(", ") || "(no declared footprint)";
  // Files a sibling unit produces that THIS unit reads — the contract-first dependency.
  // Surface it structurally (not just buried in the prose note): the worker must IMPORT the
  // sibling's contract for these files, never re-invent it (the prose-pinning the gate replaces).
  const consumes = [
    ...new Set(
      (unit.units ?? []).flatMap(
        (u) => (u as WorkUnit & { consumes?: string[] }).consumes ?? [],
      ),
    ),
  ];
  const consumesBlock =
    consumes.length > 0
      ? `\nContract dependency: this unit CONSUMES ${consumes.join(", ")} — a sibling unit produces ${consumes.length > 1 ? "these files" : "this file"}. Import ${consumes.length > 1 ? "their" : "its"} contract (types/exports/shape); do NOT re-invent it. If ${consumes.length > 1 ? "they don't exist" : "it doesn't exist"} yet, code to the contract the spec/slice describes.\n`
      : "";
  const isTest = (unit.role ?? "code") === "test";
  // Tests-first, honest brief (2026-07-08): the tester is told the TRUTH, plainly — it is
  // writing the acceptance tests UP FRONT, before the implementation exists, to the shared
  // contract; a separate implementer builds to that same contract afterward. This reverses the
  // old "framed neutrally / keep it unaware" theory, which only left workers improvising against
  // a situation they didn't understand. Independence stays STRUCTURAL — the tester's cwd is a
  // pre-feature snapshot that never contains the implementer's work — but it is a fact stated,
  // not a secret kept: transparency about the process never exposes the graded content.
  const task = isTest
    ? `You are the TEST AUTHOR for this slice. Write the acceptance test(s) at [${fp}] UP FRONT — the implementation does not exist yet; a separate implementer will build to the same SPEC CONTRACT after you. ${unit.note ? `Assert: ${unit.note.replace(/\s*\.?\s*$/, "")}.` : "Assert the behaviours in the Acceptance criteria below."} Exercise ONLY the public interface in the SPEC CONTRACT below — write to that interface, do not assume any particular internal implementation. ` +
      // Carry the WHY (2026-07-08): every check must state, in the artifact, why it exists — so a
      // reader years later knows whether its job is still live or already finished. This is what
      // separates a durable INVARIANT from a spent TRANSITION check.
      `Head each test with a one-line comment stating its WHY in plain words drawn from the acceptance criterion — the behaviour or change it proves — and label that why as either a one-time TRANSITION (it proves a change happened: something removed, added, renamed — its job is done once the change ships) or a standing INVARIANT (a behaviour that must always hold — it lives forever). A future reader must be able to tell from the test alone why it exists and whether its work is already complete.`
    : unit.shape === "mechanize"
      ? `This is a MECHANIZE unit: author ONE transform and apply it across all of [${fp}] — do not hand-edit each object.`
      : unit.shape === "fan-out"
        ? `This is a FAN-OUT unit over [${fp}].${unit.note ? ` Task: ${unit.note}` : ""}`
        : `This is a SERIAL unit — one coherent pass over your footprint (listed above).${unit.note ? ` Task: ${unit.note}` : ""}`;
  // The test convention (framework + how the file is run), injected so a test unit — which has no
  // Bash to poke the toolchain — can author a runnable test straight from its prompt (SP-6/7).
  const conventionBlock =
    isTest && context?.testConvention?.trim()
      ? `\nTest convention: ${context.testConvention.trim()}\n`
      : "";
  // SP-6/16 Part A — the repo's CANONICAL EXAMPLE TEST, injected so a test unit writes its probe
  // straight from prompt + contract instead of independently rediscovering the repo's test idiom
  // (reading whole files to reverse-engineer the fixture/assertion pattern). Rendered VERBATIM under a
  // distinct `EXAMPLE TEST` marker for test units ONLY; omitted entirely (block + marker) when
  // exampleTest is absent/blank, and NEVER rendered for a code unit. Independent of `conventionBlock`
  // above (that carries the framework + run hint; this carries the idiom to mirror).
  const exampleBlock =
    isTest && context?.exampleTest?.trim()
      ? `\n──── EXAMPLE TEST (the repo's canonical test idiom — mirror its structure / fixtures / assertions; do NOT reuse its subject) ────\n${context.exampleTest}\n`
      : "";
  // The tester's workspace, stated PLAINLY and HONESTLY (tests-first): it is writing the tests
  // BEFORE the implementation, so the contract's modules are not on disk yet — that is expected,
  // not an error to fix. Independence is structural (its cwd is a pre-feature snapshot; it never
  // sees the implementer's in-progress work) and stated as fact.
  const footprintFilesBlock = (context?.footprintFiles ?? []).length
    ? `\n──── YOUR FOOTPRINT FILES (current content at dispatch — start from these instead of reading them; re-read a file only after YOUR OWN edits) ────\n` +
      (context!.footprintFiles ?? [])
        .map((f) =>
          f.omitted
            ? `── ${f.path} ── (${f.omitted})\n`
            : `── ${f.path} ──\n${f.content}\n`,
        )
        .join("") +
      `──── END FOOTPRINT FILES ────\n`
    : "";
  const graphOrientationBlock = context?.graphOrientation?.trim()
    ? `\n──── GRAPH ORIENTATION (deterministic map from AST parsing — importers and seams around your footprint; verify against the repo, which is the authority) ────\n` +
      `${context.graphOrientation.trim()}\n──── END GRAPH ORIENTATION ────\n`
    : "";
  const workspaceBlock = isTest
    ? `\nYou are writing the tests FIRST: the implementation named in the SPEC CONTRACT does not exist in your working directory yet — that is expected and correct, NOT an error to fix or an implementation to hunt for. Your working directory is the codebase as it stands BEFORE this feature. Read anything here you need — the test harness, helpers, existing tests, import/type conventions — and write your test file(s) at your footprint (${fp}) using paths relative to the working directory. Import the contract's modules by the exact path/name it gives; they resolve once the implementer builds to the same contract. Write your tests purely from the contract + the criteria below — do not wait for or look for the implementation.\nDECISIONS RECORD: wherever the contract left a choice you had to make (a normalization rule, an exact expected literal, an error-handling semantic), end your final summary with one line per choice, starting exactly with "DECISION: " — the rule you chose plus the exact literal where applicable. Record ONLY interpretation choices the contract forced; never describe your tests or assertions.\n`
    : "";
  // ORIENTATION (2026-07-15): a worker was observed GUESSING its own cwd from its unit
  // handle (wrong), then ls-walking the tree and brushing the fences to orient itself —
  // provisioning information that costs three lines. Rendered for BOTH roles, cwd known.
  const orientationBlock = context?.cwd?.trim()
    ? `\n──── YOUR WORKSPACE (orientation — read once instead of probing) ────\n` +
      `- Your working directory IS the repository checkout: ${context.cwd.trim()}. It is complete; every path in this brief is relative to it. Use relative paths in every command and tool call.\n` +
      `- Your footprint files live at exactly those relative paths — never derive a directory from your unit id or search sibling directories for them.\n` +
      `- Sibling worktrees (paths ending in -test, other TEP-*/SP-* checkouts) belong to other roles and are fenced — never list, read, or search them.\n`
    : "";
  // SP-6/3: the Spec-wide design-time CONTRACT — the shared interface (union of every slice's
  // declared contract) every unit (code AND held-out test, in ANY slice) builds against. Injected
  // verbatim into EVERY unit's prompt so they agree on the exact seam (exports/types/signatures/
  // behaviour) WITHOUT reading each other's code — including a seam another slice owns. This is the
  // cross-slice interface agreement `consumes` used to carry, now pinned up front.
  const contractBlock = unit.contract?.trim()
    ? `\n──── SPEC CONTRACT (the shared interface across the whole feature — implement and verify EXACTLY against this; do not rename, widen, or invent) ────\n${unit.contract.trim()}\n`
    : "";
  // SP-12: a CODE unit carries the repo's sanctioned self-verify command PLUS two standing
  // prohibitions, stated up front so the worker never has to improvise into shared build config or
  // touch the held-out probes to figure out how to run tests. (A `test` unit renders NONE of these —
  // it is the held-out verifier and already gets the `acceptance/` footprint + convention.)
  //  1. VERIFICATION BLOCK — only when a self-verify command is supplied: the exact, non-mutating
  //     build-and-test invocation, verbatim, under a distinct `SELF-VERIFY` marker so its absence is
  //     grep-checkable. Omitted ENTIRELY (block + marker) when no command is declared.
  //  2. FOOTPRINT PROHIBITION (unconditional) — files outside the declared footprint, shared
  //     build/config (`tsconfig*.json`, etc.) included, are off-limits; the guard reverts a breach.
  //  3. HELD-OUT PROHIBITION (unconditional) — the held-out `acceptance/` probes are the closing
  //     gate's to grade; the worker must not build or run them.
  const selfVerify = context?.selfVerifyCommand?.trim();
  const oracle = !isTest && !!context?.oracleAvailable;
  // Tests-first (2026-07-08): with the oracle wired, the coder's ONLY feedback channel is the
  // `verify` tool — it compiles the current work together with the slice's acceptance checks in
  // an isolated runner and returns structured results (compile errors / per-check pass-fail).
  // The worker never builds or runs anything itself, so it needs no local toolchain and has no
  // reason to touch test files or shared build config.
  const verifyBlock = oracle
    ? `\n──── HOW VERIFICATION WORKS HERE (read this) ────\nA separate test author has already written this slice's acceptance checks, up front, against the SPEC CONTRACT below. You cannot see those checks' SOURCE — that is deliberate, and you do not need to (the SIBLING UNITS' PLANS section below describes WHAT they assert, in behaviour terms; only the check files themselves stay withheld). To check your work, call the \`verify\` tool (mcp__oracle__verify): it runs those checks against your CURRENT code in an isolated runner and returns the results — compile errors, or per-check PASS/FAIL with the failing line. That is your ENTIRE feedback loop; iterate until everything passes. Because \`verify\` exists you never write tests, never run builds or test commands, and never look for the check files — there is nothing to gain and those tools are switched off for you. If \`verify\` reports a failure at the boundary between your code and the checks, the usual cause is your code drifting from the contract: compare your exports against the SPEC CONTRACT signature by signature and fix the drift.\n`
    : !isTest && selfVerify
      ? `\n──── SELF-VERIFY (after editing your files, run this non-mutating build-and-test command to check your work) ────\n${selfVerify}\n`
      : "";
  const prohibitionsBlock = !isTest
    ? `\nYOUR LANE (these are the rules of the setup above, not obstacles to route around):\n` +
      `- Edit only within your declared footprint. Files outside it — shared build/config (\`tsconfig*.json\`, other tsconfig files) included — belong to others; the guard reverts an out-of-footprint write.\n` +
      (oracle
        ? `- Writing tests is the test author's job, not yours: never create, edit, read or run ANY test file (\`*.test.*\`, anything under \`acceptance/\`). Your work is the implementation; verification is the \`verify\` tool.${
            (context?.retiredTestFiles ?? []).length
              ? ` ONE EXCEPTION: the retired test files explicitly listed in your footprint (${context!.retiredTestFiles!.join(", ")}) are yours to DELETE — deletion only; never read, rewrite, or replace them.`
              : ""
          }\n` +
          `- Never run package managers or build/test commands (\`npm install\`, \`npm test\`, \`tsc\`, …). The worktree has no toolchain for you by design — \`verify\` is the whole feedback loop, and reaching for these is denied.\n`
        : `- The held-out \`acceptance/\` probes are graded by the closing gate, not by you: do not build or run them.\n`)
    : "";
  // The worker runs in a worktree of the CODE repo — the thinking space/specs dir is NOT there. Embed the
  // spec + slice so it has full context inline rather than hunting the filesystem for a spec it cannot
  // reach.
  //
  // FULL SPEC FOR BOTH ROLES (context tranche, 2026-07-14 — deliberately REVERSING the SP-6 AC1
  // "exam held out" doctrine for code units): the `stripAcceptanceCriteria` call is REMOVED for
  // code roles, so a code worker now reads the FULL spec body INCLUDING the acceptance criteria.
  // WHY: across every observed run there were ZERO cases of rubric-gaming (a coder optimising to
  // the checkbox text instead of the behaviour) — while context STARVATION failures repeated
  // (workers building to a guessed intent and missing criteria they were never shown). The grade
  // still cannot be gamed structurally: the held-out probe SOURCE remains invisible to code
  // workers (the tester-worktree isolation is unchanged) and the closing gate derives the grade
  // only from independently-authored evidence. `satisfies` ordinals stay stripped — they are
  // grader bookkeeping, not intent. The two artifacts still withheld are exactly: probe source
  // from code workers, implementation source from test workers.
  const viewOf = (body: string): string =>
    (isTest ? (body ?? "") : stripSatisfies(body ?? "")).trim();
  const intentSpec = viewOf(context?.specBody ?? "");
  const intentSlice = viewOf(context?.sliceBody ?? "");
  const intentTep = viewOf(context?.tepBody ?? "");
  // One intent body, once (SL-4): a run path with no separate spec artifact renders the TEP
  // body as the spec body too, so specBody and tepBody arrive identical. Rendering both blocks
  // would show the worker the same text twice under two headings. When the two texts match,
  // THE INTENT block alone carries it — that block IS the embedded spec context, so downstream
  // context checks (hasCtx) must see it as such. A genuinely different spec body still renders
  // its own PARENT SPEC block beside THE INTENT.
  const specIsTep = !!intentTep && intentTep === intentSpec;
  const specBlock = intentSpec && !specIsTep
    ? `\n──── PARENT SPEC (SP-${specNumber}) ────\n${intentSpec}\n`
    : "";
  const sliceBlock = intentSlice
    ? `\n──── YOUR SLICE (${unit.slice}) ────\n${intentSlice}\n`
    : "";
  // Full-intention threading (context tranche): the parent TEP — the WHY behind the spec —
  // rendered verbatim for BOTH roles. The spec approximates the TEP; when they diverge the
  // TEP is the star the delivery is eventually judged against (the intent check).
  const tepBlock = intentTep
    ? `\n──── THE INTENT — the north star (the parent TEP this spec implements) ────\n${intentTep}\n`
    : "";
  // Sibling awareness (context tranche): every sibling unit's task note, labeled by its
  // author role — a code worker sees what the test-author will assert; a test worker sees
  // what the code-author plans. Alignment without reading each other's artifacts (which
  // remain withheld: probe source from coders, implementation source from testers).
  const siblings = (context?.siblingNotes ?? []).filter((s) => s.note?.trim());
  const siblingBlock = siblings.length
    ? `\n──── SIBLING UNITS' PLANS (the run's other workers — align with them, do not duplicate or contradict them) ────\n` +
      siblings
        .map(
          (s) =>
            `- ${s.unit} [${s.slice}] (${
              s.role === "test"
                ? "what the test-author will assert"
                : "what the code-author plans"
            }): ${s.note.trim()}`,
        )
        .join("\n") +
      "\n"
    : "";
  // The go-set (context tranche): behavioural doctrine loaded from the `worker-preamble.md`
  // template (repo override → plugin dir), falling back to the bundled prose — a missing
  // file never breaks a run. The UNDELIVERED line format the orchestrator PARSES is pinned
  // separately in code below (UNDELIVERED_FORMAT_STANZA), never editable via template.
  const preamble = loadTemplate("worker-preamble") ?? BUNDLED_WORKER_PREAMBLE;
  // THE INTENT counts as embedded context on its own (SL-4): a run path with no separate spec
  // artifact still gives the worker its full brief inline — it never needs to go looking for a
  // spec that, in that path, does not exist.
  const hasCtx = specBlock || sliceBlock || tepBlock;
  return (
    `You are an autonomous Tandem worker for execution unit ${unit.id} of slice ${unit.slice}.\n` +
    `Do only THIS unit's work — write only within its footprint: ${fp}.\n` +
    (hasCtx
      ? `The thinking space/specs dir is NOT in this worktree; your intent, spec and slice context is embedded below — use it, don't search the filesystem for specs/.\n`
      : `(Read the parent spec/slice for context if available — note the specs dir may not be in this worktree.)\n`) +
    `\n${preamble.trim()}\n\n${UNDELIVERED_FORMAT_STANZA}\n` +
    `\n${task}\n` +
    contractBlock +
    verifyBlock +
    prohibitionsBlock +
    conventionBlock +
    exampleBlock +
    orientationBlock +
    footprintFilesBlock +
    graphOrientationBlock +
    workspaceBlock +
    consumesBlock +
    tepBlock +
    specBlock +
    sliceBlock +
    siblingBlock +
    `\nWork autonomously to the intent (goal / design / behaviour) described above — build what "correct" means here. Make reasonable engineering decisions and do NOT ask for confirmation. ` +
    `Do NOT commit, run git, or move the thinking space card — the orchestrator owns git and the gate. ` +
    // Terminate-on-denial (SP-6/7), redirect-aware: never BRUTE-FORCE a boundary (the drive to finish
    // is what turns a blocked worker into one grinding through Bash / alternate paths), but a denial
    // that redirects to a better source is followed, and only a genuine dead-end stops the worker.
    `\nIf the SYSTEM denies a tool call, do NOT brute-force around it — no retrying, no routing through another tool, no alternate path to defeat the constraint. If the denial's message points you to a better source or way of working, follow it and carry on. Only if you genuinely cannot proceed from the spec / slice / contract / codebase, output a single final message beginning with ${NEEDS_INPUT_SENTINEL} that quotes the blocker, then stop. ` +
    `Likewise, if you hit a genuine decision you cannot make from that context, output a single final message that begins with ${NEEDS_INPUT_SENTINEL} followed by your question, then stop — never guess, never brute-force a boundary.`
  );
}

/** The marker a blocked worker prepends to its question so the orchestrator can park it (SL-3). */
export const NEEDS_INPUT_SENTINEL = "⟦NEEDS-INPUT⟧";

/**
 * Pull a worker's escalated question out of its output (SL-3): the text after the
 * `⟦NEEDS-INPUT⟧` marker, or null if the worker never escalated. Pure.
 */
export function extractNeedsInput(text: string): string | null {
  const i = text.indexOf(NEEDS_INPUT_SENTINEL);
  if (i === -1) return null;
  return (
    text.slice(i + NEEDS_INPUT_SENTINEL.length).trim() || "(no question text)"
  );
}

/** The session id carried on a stream-json / SDK event, for resume-on-answer (SL-3/SL-5). */
export function sessionIdOf(evt: Record<string, unknown>): string | undefined {
  const s = evt.session_id;
  return typeof s === "string" && s ? s : undefined;
}

/**
 * Extract a failure diagnosis from a delivery report OR a slice body (SP-11/3, extending
 * AC4). Matches the delivery report's plain-language `## What happened` prose FIRST; if that heading
 * is absent (or empty), falls back to the slice body's `## ⚑ Requires attention` heading — so the
 * existing `/attend` slice-diagnosis caller keeps working unchanged. Returns undefined when neither is
 * present. The attended-session divergence is `extractDiagnosis(report)`, passed verbatim.
 */
export function extractDiagnosis(body: string): string | undefined {
  const text = body ?? "";
  // Consume ONLY the heading's own line-break (not the blank separator) so an EMPTY What-happened
  // section captures "" and correctly falls through to the ⚑ heading below.
  const wh = /##\s*What happened[ \t]*\r?\n([\s\S]*?)(?:\r?\n##\s|$)/.exec(
    text,
  );
  if (wh?.[1]?.trim()) return wh[1].trim();
  const m = /##\s*⚑\s*Requires attention\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(
    text,
  );
  return m?.[1]?.trim() || undefined;
}

/**
 * Extract a worker's out-of-scope findings (SP-11/3) — the list items / paragraphs under a **trailing**
 * `## Discoveries` heading of its final output — with list markers stripped and each line trimmed.
 * `"## Discoveries\n- a\n- b"` → `["a","b"]`; the heading absent ⇒ `[]`. The convention is declared
 * (the discovery channel): the orchestrator pairs each returned item with its unit id and feeds them —
 * verbatim, no model-side summarizing — into the report's `## Discoveries & recommendations`. Pure.
 */
export function extractDiscoveries(finalOutput: string): string[] {
  const text = finalOutput ?? "";
  // The TRAILING `## Discoveries` heading — take the last one if a body repeats it.
  const re = /^##\s+Discoveries\s*$/gim;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) start = m.index + m[0].length;
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of text.slice(start).split(/\r?\n/)) {
    if (/^\s*#{1,6}\s+/.test(line)) break; // the next heading ends the section
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    if (stripped) items.push(stripped);
  }
  return items;
}

