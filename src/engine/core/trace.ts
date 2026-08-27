import { StubScanHit } from "./stubScan";
import { AcResult, AcVerification } from "./closingGate";
import { Fault } from "./redispatch";
import { clip } from "./guidance";
// ── Durable, structured verification trace (SP-6/7 AC5) ────────────────────
//
// The delivery report's per-AC table is ephemeral prose; AC5 needs a DURABLE, structured record —
// per AC and per rework round — of HOW each criterion was verified, so the methodology itself can be
// debugged and improved. `buildVerificationTrace` derives that structure from the per-AC results: for
// each AC it records the verification `kind` (a held-out `probe` command vs an independent
// `assessment`), the `verdict`, the assessor/judge `rationale`, and — when the run was red and judged
// — the code-vs-test `route`. The shell persists it as JSON alongside DELIVERY.md (accumulating across
// runs, keyed by AC + round) and surfaces it in the delivery report + panel.

/** One entry of the structured verification trace (SP-6/7 AC5) — one AC's verdict in one rework round. */
export interface VerificationTraceEntry {
  /** 1-based AC ordinal this entry records. */
  ac: number;
  /** The rework round it was verified in (1 = the first attempt; bumped each re-dispatch). */
  round: number;
  /** How it was verified: a held-out `probe` command, or an independent `assessment`. */
  kind: "probe" | "assessment";
  verdict: "pass" | "fail";
  /** The assessor's rationale / the probe's evidence tail — why this verdict. */
  rationale?: string;
  /** SP-6/7 AC4: the judged code-vs-test route recorded for a FAILED AC (absent on a pass / un-judged). */
  route?: Fault;
}

/** Inputs to {@link buildVerificationTrace}: one run's per-AC results + how to place each in the trace. */
export interface VerificationTraceInput {
  /** The rework round this run represents for the AC's slice (1-based). A number, or a per-AC lookup. */
  round: number | ((ac: number) => number);
  /** The declared per-AC plan — its `env` distinguishes `assessment` from a runnable `probe`. */
  declared: AcVerification[];
  /** The per-AC results (pass/fail + evidence) this run produced. */
  acResults: AcResult[];
  /** AC ordinal → the judged re-dispatch route for a FAILED AC (SP-6/7 AC4). */
  routes?: ReadonlyMap<number, Fault> | Record<number, Fault>;
}

/**
 * Build one run's slice of the structured verification trace (SP-6/7 AC5): one entry per AC result,
 * recording its round, verification kind (`assessment` when the declared `env` is `assessment`, else a
 * held-out `probe`), verdict, rationale (the evidence tail — the assessor's rationale for an
 * assessment, the command output for a probe), and — for a failed, judged AC — the code-vs-test route.
 * Pure → unit-tested; the shell merges these into the durable per-Spec trace file. See AC5.
 */
export function buildVerificationTrace(
  i: VerificationTraceInput,
): VerificationTraceEntry[] {
  const envByAc = new Map(i.declared.map((v) => [v.ac, v.env]));
  const roundOf = (ac: number): number =>
    typeof i.round === "function" ? i.round(ac) : i.round;
  const routeOf = (ac: number): Fault | undefined => {
    const r = i.routes;
    if (!r) return undefined;
    return r instanceof Map ? r.get(ac) : (r as Record<number, Fault>)[ac];
  };
  return i.acResults.map((r) => {
    const kind: VerificationTraceEntry["kind"] =
      envByAc.get(r.ac) === "assessment" ? "assessment" : "probe";
    const entry: VerificationTraceEntry = {
      ac: r.ac,
      round: roundOf(r.ac),
      kind,
      verdict: r.pass ? "pass" : "fail",
      rationale: (r.evidence ?? "").trim() || undefined,
    };
    const route = routeOf(r.ac);
    if (!r.pass && route) entry.route = route;
    return entry;
  });
}

/**
 * Merge this run's trace entries into the durable, accumulating per-Spec trace (SP-6/7 AC5). Keyed on
 * `ac`+`round`, a new entry REPLACES an existing one for the same AC+round (a re-run of the same round
 * overwrites its stale verdict) and is otherwise appended — so the persisted trace carries every AC
 * across every rework round without duplication. Sorted by round then AC for a stable, readable file.
 * Pure → the shell reads the prior file, calls this, and writes the result back.
 */
export function mergeVerificationTrace(
  prior: VerificationTraceEntry[],
  next: VerificationTraceEntry[],
): VerificationTraceEntry[] {
  const key = (e: VerificationTraceEntry) => `${e.round}::${e.ac}`;
  const byKey = new Map<string, VerificationTraceEntry>();
  for (const e of prior ?? []) byKey.set(key(e), e);
  for (const e of next ?? []) byKey.set(key(e), e);
  return [...byKey.values()].sort((a, b) => a.round - b.round || a.ac - b.ac);
}

/** One execution unit's outcome, for the delivery report's per-unit table. */
export interface ReportUnit {
  id: string;
  outcome: "success" | "needs-input" | "failed";
}

/**
 * SP-11/2 — the id of a post-orchestration exit. The exit SET is derived from the run's terminal
 * state (see {@link deliveryExitState}), never glued on fixed: a **delivered** run offers
 * `accept` / `request-changes`; a **stalled** run offers `attend` / `rerun` — no impossible
 * `accept` on a stalled run, no mislabeled reject.
 */
export type ExitActionId = "accept" | "request-changes" | "attend" | "rerun";

/** SP-11/2 — one post-orchestration exit: a stable `id` (dispatched on) + its human `label`. */
export interface ExitAction {
  id: ExitActionId;
  label: string;
}

/**
 * SP-11/2 — the SINGLE source of truth mapping a run's terminal state to its exit set. Both the
 * delivery report's `## Next` section and the graph's buttons consume THIS (no second derivation):
 *
 *   • **delivered** ⇔ the change committed AND the closing gate passed → exits
 *     `[accept ("Accept & merge"), request-changes ("Request changes")]`, in that order;
 *   • **stalled** ⇔ anything else (not committed and/or the gate did not pass) → exits
 *     `[attend ("Attend"), rerun ("Re-run")]`, in that order — the actions that actually apply to a
 *     run that did not deliver (no impossible Accept, no mislabeled Reject).
 *
 * Labels are pinned exactly. Pure → unit-tested.
 */
export function deliveryExitState(run: {
  committed: boolean;
  gatePassed: boolean;
}): { state: "delivered" | "stalled"; exits: ExitAction[] } {
  return run.committed && run.gatePassed
    ? {
        state: "delivered",
        exits: [
          { id: "accept", label: "Accept & merge" },
          { id: "request-changes", label: "Request changes" },
        ],
      }
    : {
        state: "stalled",
        exits: [
          { id: "attend", label: "Attend" },
          { id: "rerun", label: "Re-run" },
        ],
      };
}

/**
 * SP-11/2 — the one-line hint rendered after each exit's bold label in the delivery report's
 * `## Next` section (`N. **<label>** — <hint>`). Keyed by {@link ExitActionId} so the report and
 * the exit-state model can never drift on what each action means.
 */
const NEXT_HINTS: Record<ExitActionId, string> = {
  accept:
    "merge the Spec to `main` (gated on every AC checked) — the per-AC table above is the evidence.",
  "request-changes":
    "open a primed `/attend` session to steer the delivered change back in line with the intent.",
  attend:
    "open a primed session on the requires-attention slice(s) to bring the behaviour back in line.",
  rerun:
    "resolve the requires-attention slice(s), then re-run Orchestrate on the Spec.",
};

/** Everything the auditable delivery report (DELIVERY.md) records. */
export interface DeliveryReportInput {
  /** The north-star verdict at delivery (2026-07-14): unavailable is reported, never passed off. */
  intentCheck?: { fulfilled: boolean; gaps: string[]; unavailable?: string };
  specNumber: string;
  /** Short HEAD sha the Spec was committed at (or "" when nothing committed). */
  sha: string;
  /** The union of the units' footprints. */
  files: string[];
  /** Per-execution-unit outcomes. */
  units: ReportUnit[];
  /** The declared per-AC verification plan (how each AC is verified). */
  declared: AcVerification[];
  /** The per-AC verification results (pass/fail + evidence). Empty when the gate couldn't run. */
  acResults: AcResult[];
  /** Worker-reported problems / requires-attention diagnoses caught this run. */
  problems?: string[];
  /** Slices advanced to Done this run. */
  advanced: string[];
  /** Slices left requires-attention this run. */
  attention?: string[];
  /** The whole Spec landed green and was committed. */
  committed: boolean;
  /** The durable, structured verification trace (SP-6/7 AC5) — per AC and per rework round: kind,
   *  verdict, rationale, and any code-vs-test route. Rendered as an auditable table; omitted/empty ⇒
   *  the trace section is left off (backward-compatible with pre-AC5 reports). */
  trace?: VerificationTraceEntry[];
  /** SP-11/3: the closing-gate judge's UNCLIPPED per-AC rationale. On a failed run these texts are
   *  rendered VERBATIM (never truncated) as the flowing `## What happened` prose — the diagnosis stops
   *  dying after the trace-table clip. Omitted ⇒ a plain failure/success summary is synthesized. */
  diagnosis?: { ac: number; text: string }[];
  /** SP-11/3: the Spec's criterion lines, index k-1 ↔ AC k. When supplied, the `## Acceptance criteria`
   *  rows carry the criterion's TEXT (`#k — <acTexts[k-1]> — <verdict>`) instead of a bare ordinal
   *  table; omitted ⇒ today's ordinal-only table form remains. */
  acTexts?: string[];
  /** SP-11/3: out-of-scope findings workers reported under a trailing `## Discoveries` heading, each
   *  paired with its unit id by the orchestrator. Rendered under `## Discoveries & recommendations`
   *  (both unit and text); empty/omitted ⇒ the literal "none reported". */
  discoveries?: { unit: string; text: string }[];
  /** The go-set exit protocol (context tranche, 2026-07-14): every `UNDELIVERED:` line workers
   *  declared in their final summaries, verbatim, paired with the declaring unit. Rendered
   *  prominently as `## Undelivered — declared by the workers` right after the intent-check
   *  section ("none declared" when empty). `undefined` omits the section (pre-tranche callers). */
  undelivered?: { unit: string; text: string }[];
  /** The deterministic stub scan (context tranche): self-declared deferral markers found in the
   *  delivered code files at delivery-report time. Rendered as `## Self-declared deferrals found
   *  in the delivered code` ("none found" when empty). `undefined` omits the section. */
  stubScan?: StubScanHit[];
  /** Repair window (2026-07-08): the `prepare` build failure that stopped the closing gate before
   *  ANY AC could run — command + bounded raw output. Rendered as a first-class
   *  `## Build failed before verification` section right after `## What happened`, so the one
   *  failure that blocks every criterion never renders as a blank "all ACs not run / no evidence". */
  buildFailure?: { command: string; output: string };
  /** SP-11/2 — the run's state-derived exit set ({@link deliveryExitState}). When present,
   *  `buildDeliveryReport` renders the `## Next` section as numbered bold-label lines
   *  (`N. **<label>** — <hint>`) from it; omitted ⇒ the hard-coded Next text remains
   *  (backward-compatible). */
  exits?: ExitAction[];
  /** 2026-07-12 — every deviation from the initially approved plan made during this run (the
   *  plan-repair lane's amendments: AC carve-outs, contract seams, unit-note fixes), each with the
   *  intent-based justification. Rendered as a first-class `## Changes to the approved plan`
   *  section right after `## What happened`, so the human Accept decision is informed: what was
   *  approved is not necessarily what was delivered, and the difference must never be hunted for.
   *  Empty/omitted on a committed run ⇒ the section states the plan was delivered as approved. */
  planChanges?: {
    slice: string;
    round: number;
    summary: string;
    justification: string;
  }[];
}

/**
 * Build the auditable delivery report (DELIVERY.md) — the operator's document (SP-11/3). The
 * closing gate writes it on EVERY completion (pass or fail), in a human-first section order:
 *
 *   `# Delivery —` → `## What happened` → `## Acceptance criteria` →
 *   `## Discoveries & recommendations` → `## Files` → `## Next` → `## Evidence appendix`
 *
 * **What happened** opens in plain language: on a FAILURE (nothing committed OR any AC red) it is the
 * closing-gate judge's diagnosis (`i.diagnosis`) rendered VERBATIM and unclipped as flowing prose; on
 * SUCCESS it is a plain summary of what was delivered. **Acceptance criteria** carries the criterion's
 * TEXT (`#k — <acTexts[k-1]> — <verdict>`) when `i.acTexts` is supplied, else today's ordinal-only
 * table. **Discoveries & recommendations** surfaces workers' out-of-scope findings ("none reported"
 * when empty). The raw runner output (per-AC fenced evidence blocks) and the machine-readable
 * verification trace table are DEMOTED — not deleted — into the trailing **Evidence appendix**, along
 * with the per-unit outcomes and any caught problems. Pure → unit-tested.
 */
export function buildDeliveryReport(i: DeliveryReportInput): string {
  // Intent check (2026-07-14): rendered FIRST-CLASS, right after What happened —
  // "all ACs green" must never again read as "the intent is fulfilled".
  const tep = `TEP-${i.specNumber.replace("/", "_SP-")}`;
  const branch = `spec/${tep}`;
  const failed = !i.committed || i.acResults.some((r) => !r.pass);

  // ── ## What happened — plain-language, diagnosis VERBATIM on failure ──────────
  // On failure the judge's per-AC diagnosis texts are joined as prose, each one UNCLIPPED (the
  // diagnosis stops dying after the trace-table clip). On success a plain delivery summary.
  const diagTexts = (i.diagnosis ?? [])
    .map((d) => d?.text)
    .filter((t): t is string => !!t && !!t.trim());
  const whatHappened = failed
    ? i.buildFailure
      ? "The assembled change did not build, so verification never started — every acceptance criterion below reads *not run* because of the single build failure shown next, not because of individual criterion failures."
      : diagTexts.length
        ? diagTexts.join("\n\n")
        : "The closing gate did not pass. The acceptance criteria below record which criteria are red; the evidence appendix carries the raw runner output for why."
    : `Delivered ${i.advanced.length} slice(s) to Done across ${i.units.length} execution unit(s), committed to \`${branch}\`${i.sha ? ` at \`${i.sha}\`` : ""}.`;

  // ── ## Changes to the approved plan (2026-07-12) ──────────────────────────────
  // The plan-repair lane may amend instruments (AC carve-outs, contract seams, unit notes)
  // mid-run, anchored to the intent. Every such deviation renders here, first-class — the
  // Accept decision must see the delta between the approved plan and the delivered one
  // without hunting through slice cards. On a clean committed run the section states,
  // explicitly, that no deviation happened (silence would be ambiguous).
  const planChanges = (i.planChanges ?? []).filter(
    (c) => c && ((c.summary ?? "").trim() || (c.justification ?? "").trim()),
  );
  const planChangesSection = planChanges.length
    ? [
        "## Changes to the approved plan",
        "",
        "The run amended the plan below against the Spec's intent (the intent itself is never " +
          "machine-amended). Review each before accepting — what was approved is not byte-for-byte " +
          "what was delivered:",
        "",
        ...planChanges.flatMap((c, k) => [
          `${k + 1}. **${c.slice} — plan repair (round ${c.round})**`,
          `   - What changed: ${c.summary.trim()}`,
          `   - Why the intent justifies it: ${c.justification.trim()}`,
        ]),
        "",
      ]
    : i.committed
      ? [
          "## Changes to the approved plan",
          "",
          "None — delivered exactly to the plan as approved.",
          "",
        ]
      : [];

  // ── ## Build failed before verification (repair window, 2026-07-08) ───────────
  // The one failure that blocks EVERY criterion gets first-class, raw-output billing.
  const buildFailSection = i.buildFailure
    ? [
        "## Build failed before verification",
        "",
        `\`$ ${i.buildFailure.command}\``,
        "",
        "```",
        i.buildFailure.output.trim() || "(no output captured)",
        "```",
        "",
      ]
    : [];

  // ── ## Intent check — the TEP as north star (2026-07-14) ─────────────────────
  const intentSection = !i.intentCheck
    ? []
    : i.intentCheck.unavailable
      ? [
          "## Intent check — the TEP as north star",
          "",
          `**Unavailable** (${i.intentCheck.unavailable}) — the delivery was NOT intent-checked; judge it yourself against the parent TEP before accepting.`,
          "",
        ]
      : i.intentCheck.fulfilled
        ? [
            "## Intent check — the TEP as north star",
            "",
            "✓ The delivered change is assessed to fulfill the parent TEP's intent — every user-visible promise is observable in the delivery.",
            "",
          ]
        : [
            "## Intent check — the TEP as north star",
            "",
            "**⚑ ALL ACCEPTANCE CRITERIA ARE GREEN — AND THE INTENT IS NOT FULFILLED.** The spec's criteria did not cover these promises of the parent TEP:",
            "",
            ...i.intentCheck.gaps.map((g, k) => `${k + 1}. ${g}`),
            "",
            "Do not Accept until each gap is delivered or explicitly waived — green checkboxes do not overrule the north star.",
            "",
          ];

  // ── ## Undelivered — declared by the workers (the go-set exit protocol) ───────
  // A declared gap is ROUTED, not buried: every worker `UNDELIVERED:` line renders here
  // verbatim, right after the intent check, so the Accept decision sees what the workers
  // themselves say is missing. "none declared" when the channel was open and stayed empty;
  // the section is omitted entirely only for pre-tranche callers that never collected it.
  const undeliveredSection =
    i.undelivered === undefined
      ? []
      : [
          "## Undelivered — declared by the workers",
          "",
          ...(i.undelivered.length
            ? i.undelivered.map((u) => `- \`${u.unit}\` — ${u.text}`)
            : ["none declared"]),
          "",
        ];

  // ── ## Self-declared deferrals found in the delivered code (stub scan) ────────
  // The deterministic floor under the declared channel: confession markers greped
  // out of the delivered files (TODO/FIXME/not implemented/…), file:line + the
  // clipped line text. Weak markers (stub/no-op/placeholder — design and test
  // vocabulary as often as confession) render under their own review-by-eye
  // heading so the deferrals headline never over-claims.
  const stubConfessions = (i.stubScan ?? []).filter((h) => !h.weak);
  const stubWeak = (i.stubScan ?? []).filter((h) => h.weak);
  const renderHit = (h: StubScanHit): string =>
    `- \`${h.file}:${h.line}\` — ${h.text.replace(/`/g, "'")}`;
  const stubSection =
    i.stubScan === undefined
      ? []
      : [
          "## Self-declared deferrals found in the delivered code",
          "",
          ...(stubConfessions.length
            ? stubConfessions.map(renderHit)
            : ["none found"]),
          "",
          ...(stubWeak.length
            ? [
                "### Weak markers (design/test vocabulary — verify by eye, not counted as deferrals)",
                "",
                ...stubWeak.map(renderHit),
                "",
              ]
            : []),
        ];

  // ── ## Acceptance criteria — criterion text + verdict, or the ordinal table ───
  const resultFor = new Map(i.acResults.map((r) => [r.ac, r]));
  const verdictOf = (ac: number): string => {
    const r = resultFor.get(ac);
    return !r ? "· not run" : r.pass ? "✓ pass" : "✗ fail";
  };
  const hasAcTexts = !!(i.acTexts && i.acTexts.length);
  let acSection: string[];
  if (!i.declared.length) {
    acSection = [
      "## Acceptance criteria",
      "",
      "**No `ac_verifications` declared on the Spec — the closing gate could not run.** " +
        "The acceptance criteria were NOT verified; the Spec is left `requires-attention` " +
        "(no skip). Declare a per-AC verification map on the Spec, then re-run.",
    ];
  } else if (hasAcTexts) {
    // Criterion-text rows: keep today's `#k` ordinal token, carry the Spec's criterion line.
    acSection = [
      "## Acceptance criteria",
      "",
      ...i.declared.map((v) => {
        const text =
          (i.acTexts?.[v.ac - 1] ?? "").trim() ||
          "(criterion text unavailable)";
        // Honest evidence labeling (2026-07-14): every ✓/✗ names WHAT was actually
        // exercised — the run command, or "assessment" for a judged criterion — so a
        // component-level probe can never masquerade as end-to-end proof at Accept.
        // (Seen live on SP-21/1: surface-level AC prose ticked green on the strength
        // of gate-map and serialize probes; the informed Accept wasn't informed.)
        const how = v.run.trim()
          ? `verified by \`${v.run.trim()}\``
          : "graded by independent assessment (judged, not driven)";
        return `- #${v.ac} — ${text} — ${verdictOf(v.ac)} · ${how}`;
      }),
    ];
  } else {
    // Ordinal-only table form (acTexts omitted) — unchanged.
    acSection = [
      "## Acceptance criteria",
      "",
      "| AC | Verified by | Env | Result |",
      "| --- | --- | --- | --- |",
      ...i.declared.map(
        (v) =>
          `| #${v.ac} | \`${v.run.replace(/\|/g, "\\|")}\` | ${v.env ?? "—"} | ${verdictOf(v.ac)} |`,
      ),
    ];
  }

  // ── ## Discoveries & recommendations — both unit and text, "none reported" empty ─
  const discoveries = (i.discoveries ?? []).filter(
    (d) => d && ((d.text ?? "").trim() || (d.unit ?? "").trim()),
  );
  const discSection = [
    "## Discoveries & recommendations",
    "",
    ...(discoveries.length
      ? discoveries.map((d) => `- \`${d.unit}\` — ${d.text}`)
      : ["none reported"]),
  ];

  // ── ## Files ──────────────────────────────────────────────────────────────────
  const fileList = i.files.length
    ? i.files.map((f) => `- \`${f}\``).join("\n")
    : "- (none)";

  // ── ## Evidence appendix — raw runner output + trace + unit outcomes, demoted ──
  const acEvidenceBlocks = i.acResults.length
    ? i.acResults
        .map(
          (r) =>
            `**AC #${r.ac}** — ${r.pass ? "✓ pass" : "✗ fail"}\n\n\`\`\`\n${r.evidence}\n\`\`\``,
        )
        .join("\n\n")
    : "_No per-AC evidence captured this run._";

  // SP-6/7 AC5: the durable, structured verification trace — demoted into the evidence appendix.
  const trace = i.trace ?? [];
  const traceBlock = trace.length
    ? [
        "### Verification trace",
        "",
        "| AC | Round | Kind | Verdict | Route | Rationale |",
        "| --- | --- | --- | --- | --- | --- |",
        ...trace.map((e) => {
          const v = e.verdict === "pass" ? "✓ pass" : "✗ fail";
          const rationale = clip(
            (e.rationale ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|"),
            160,
          );
          return `| #${e.ac} | ${e.round} | ${e.kind} | ${v} | ${e.route ?? "—"} | ${rationale || "—"} |`;
        }),
        "",
      ]
    : [];

  const glyph = (o: ReportUnit["outcome"]) =>
    o === "success" ? "✓" : o === "needs-input" ? "❓" : "✗";
  const unitRows = i.units.length
    ? i.units.map((u) => `| \`${u.id}\` | ${glyph(u.outcome)} ${u.outcome} |`)
    : ["| — | (none) |"];
  const unitBlock = [
    "### Execution units",
    "",
    "| Unit | Outcome |",
    "| --- | --- |",
    ...unitRows,
    "",
  ];

  const problems = (i.problems ?? []).filter(Boolean);
  const problemBlock = problems.length
    ? ["### Caught problems", "", ...problems.map((p) => `- ${p}`), ""]
    : [];

  // SP-11/2 — the `## Next` items. With a state-derived exit set present, render numbered
  // bold-label lines (`N. **<label>** — <hint>`) from it — one source of truth for the report
  // and the graph's buttons. Omitted ⇒ the hard-coded text (backward-compatible).
  const nextLines =
    i.exits && i.exits.length
      ? i.exits.map(
          (e, idx) => `${idx + 1}. **${e.label}** — ${NEXT_HINTS[e.id] ?? ""}`,
        )
      : [
          i.committed
            ? `1. Review the \`${branch}\` branch (the committed change) — the acceptance criteria above and the evidence appendix are the proof.\n` +
              `2. **Accept** to merge the Spec to \`main\` (gated on every AC checked), or **Reject** to open a primed session.`
            : `1. The closing gate did not pass — see What happened above and the evidence appendix below.\n` +
              `2. Resolve the requires-attention slice(s), then re-run Orchestrate on the Spec.`,
        ];

  const appendix = [
    "## Evidence appendix",
    "",
    acEvidenceBlocks,
    "",
    ...traceBlock,
    ...unitBlock,
    ...problemBlock,
  ];

  return [
    `# Delivery — ${tep}`,
    "",
    `Orchestrated to branch \`${branch}\`${i.sha ? ` at \`${i.sha}\`` : ""}. ` +
      `${i.advanced.length} slice(s) advanced to Done; ${i.units.length} execution unit(s) ran` +
      `${i.committed ? " — committed ✓" : " — not committed"}.`,
    "",
    "## What happened",
    "",
    whatHappened,
    "",
    ...intentSection,
    ...undeliveredSection,
    ...stubSection,
    ...planChangesSection,
    ...buildFailSection,
    ...acSection,
    "",
    ...discSection,
    "",
    "## Files",
    "",
    fileList,
    "",
    "## Next",
    "",
    ...nextLines,
    "",
    ...appendix,
    "",
  ].join("\n");
}

