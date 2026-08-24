/**
 * The delivery's evidence record: the honesty scan over the diff, the
 * machine-face persisted beside the space, and the checks a delivery
 * carries so they can be restored into a later tree.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AcVerification } from "../engine/orchestratorCore";
import { buildVerificationTrace } from "../engine/core/trace";
import { readFileSync } from "node:fs";
import type { Proof } from "../core/schema";
import type { Exec } from "./oracle";
import * as fsp from "node:fs/promises";

/**
 * The honesty scan over the delivered code: every file the run created or
 * changed, read for self-declared deferrals. A confession in a shipped
 * file is UNDELIVERED on the delivery's face, never a footnote.
 */
/** The word "undelivered" is this codebase's own vocabulary — a field, a
 *  list, a doc line about the mechanism. A confession is the marker in its
 *  form, `UNDELIVERED:` in capitals, or another marker word; the vocabulary
 *  alone is not a deferral. */
const OTHER_MARKERS = /\b(TODO|FIXME|XXX|HACK|not in scope|not implemented|unimplemented|pending SDK)\b/i;
function isDeferralVocabulary(text: string): boolean {
  return !OTHER_MARKERS.test(text) && !/\bUNDELIVERED\s*:/.test(text);
}

/**
 * The lines this run ADDED, per file, with the line number they landed on.
 *
 * Read from the diff git already has, so nothing has to judge whether a
 * marker word means what it says: a line that was in the tree before is
 * not this work's confession, whoever wrote it and why.
 */
async function addedLines(
  worktree: string,
  baseSha: string,
  exec: Exec,
): Promise<Map<string, Map<number, string>>> {
  const out = new Map<string, Map<number, string>>();
  const diff = (
    await exec("git", ["-C", worktree, "diff", "--unified=0", "--diff-filter=d", `${baseSha}..HEAD`], worktree)
  ).out;
  let file = "";
  let at = 0;
  for (const line of diff.split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      file = f[1];
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      at = Number(h[1]);
      continue;
    }
    if (!file || !line.startsWith("+")) continue;
    const rows = out.get(file) ?? new Map<number, string>();
    rows.set(at++, line.slice(1));
    out.set(file, rows);
  }
  return out;
}

export async function confessedDeferrals(args: {
  worktree: string;
  baseSha: string;
  exec: Exec;
  extraPaths: string[];
  onHit: (file: string, line: number, text: string) => void;
}): Promise<string[]> {
  const { isStubScannableFile, scanStubMarkers } = await import("../engine/core/stubScan");
  const out: string[] = [];
  const delivered = (
    await args.exec(
      "git",
      ["-C", args.worktree, "diff", "--name-only", "--diff-filter=d", `${args.baseSha}..HEAD`],
      args.worktree,
    )
  ).out
    .split("\n")
    .concat(args.extraPaths)
    .map((p) => p.trim())
    .filter(Boolean);
  // Only the lines THIS RUN WROTE. The scan read whole files and handed a
  // run its own repository back: the regular expression that defines the
  // marker words, the code that formats the report, a fixture string —
  // four confessions, none of them deferrals, in files the run had touched
  // for unrelated reasons. A marker already in the tree is the
  // repository's business; a marker this work added is this work
  // confessing. The difference is what git already knows, and needs no
  // opinion about which words mean what.
  const written = await addedLines(args.worktree, args.baseSha, args.exec);
  for (const rel of [...new Set(delivered)]) {
    if (!isStubScannableFile(rel)) continue;
    const mine = written.get(rel);
    // A path named outside the diff (a check restored from a record) has
    // no added lines to read, and is taken whole as it always was.
    let content = "";
    if (!mine) {
      try {
        content = await fs.readFile(path.join(args.worktree, rel), "utf8");
      } catch {
        continue;
      }
    }
    const hits = mine
      ? [...mine].map(([line, text]) => ({ ...scanStubMarkers(rel, text)[0], file: rel, line }))
          .filter((h): h is { file: string; line: number; text: string; weak: boolean } => !!h.text)
      : scanStubMarkers(rel, content);
    for (const h of hits.filter((x) => !x.weak && !isDeferralVocabulary(x.text))) {
      out.push(`${h.file}:${h.line} confesses a deferral: ${h.text}`);
      args.onHit(h.file, h.line, h.text);
    }
  }
  return out;
}

/**
 * The delivery's MACHINE FACE persists beside the space: the engine's
 * structured verification trace plus the run facts — the delivery page is
 * a render, this file is the evidence record. Best-effort: the run's
 * verdicts already live on the delivery.
 */
export async function writeDeliveryRecord(
  storeDir: string,
  record: {
    tep: string;
    branch: string;
    baseSha: string;
    proofs: Proof[];
    undelivered: string[];
    verifs: AcVerification[];
    acResults: Parameters<typeof buildVerificationTrace>[0]["acResults"];
    /** The run that produced this record, and when — the same id and
     *  stamp the gate put on the delivery it handed back. Optional only
     *  for a caller that predates the field; the gate always supplies it. */
    runId?: string;
    producedAt?: string;
    /** The checks themselves — kept here because the files are discarded.
     *  Passed only by an OPENED delivery: a withheld run once overwrote a
     *  good record's fifty-eight sources with thirty-eight entries at the
     *  wrong addresses, and the next run could restore nothing. Absent, the
     *  record's existing checks are preserved. */
    checks?: KeptCheck[];
    /** Attention events about the machine in this run. Target: zero. */
    machineAttention?: number;
    /** What only the person can certify, on the delivery's face. */
    observations?: string[];
  },
): Promise<void> {
  try {
    const trace = buildVerificationTrace({
      round: 1,
      declared: record.verifs,
      acResults: record.acResults,
    });
    const dir = path.join(storeDir, "deliveries");
    await fsp.mkdir(dir, { recursive: true });
    // What an opened delivery captured outlives every later failed run.
    const checks =
      record.checks?.length
        ? record.checks
        : (() => {
            try {
              return (JSON.parse(readFileSync(path.join(dir, `${record.tep}.json`), "utf8")) as { checks?: KeptCheck[] })
                .checks ?? [];
            } catch {
              return [];
            }
          })();
    await fsp.writeFile(
      path.join(dir, `${record.tep}.json`),
      JSON.stringify(
        {
          tep: record.tep,
          branch: record.branch,
          baseSha: record.baseSha,
          proofs: record.proofs,
          undelivered: record.undelivered,
          ...(record.runId ? { runId: record.runId } : {}),
          ...(record.producedAt ? { producedAt: record.producedAt } : {}),
          trace,
          ...(checks.length ? { checks } : {}),
          machineAttention: record.machineAttention ?? 0,
          ...(record.observations?.length ? { observations: record.observations } : {}),
        },
        null,
        2,
      ),
    );
  } catch {
    /* best-effort */
  }
}

/** A check whose file leaves the tree: what it proved, and its source. */
/**
 * Put a delivery's recorded checks back into a tree.
 *
 * A delivery consumes its checks — the sources live on the record, the
 * files leave the tree. A run of the same cut after that (the person ran
 * it again, or the acceptance loop proves it three times) finds standing
 * testers and no check files, which once turned a fully-delivered cut into
 * sixty-four file-not-found reds. What the record kept is written back,
 * and only where nothing else has since claimed the path.
 */
/** The check paths a cut's delivery record holds, or nothing. */
export function recordedCheckPaths(storeDir: string, tep: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(storeDir, "deliveries", `${tep}.json`), "utf8"),
    ) as { checks?: { path?: string }[] };
    return (parsed.checks ?? []).map((c) => c.path).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

export async function restoreChecksFromRecord(
  storeDir: string,
  tep: string,
  worktree: string,
  wanted: readonly string[],
): Promise<string[]> {
  let checks: KeptCheck[];
  try {
    const raw = await fsp.readFile(path.join(storeDir, "deliveries", `${tep}.json`), "utf8");
    checks = (JSON.parse(raw) as { checks?: KeptCheck[] }).checks ?? [];
  } catch {
    return [];
  }
  const restored: string[] = [];
  for (const rel of wanted) {
    const kept = checks.find((c) => c.path === rel);
    if (!kept) continue;
    const dst = path.join(worktree, rel);
    if (await fsp.access(dst).then(() => true, () => false)) continue;
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.writeFile(dst, kept.source);
    restored.push(rel);
  }
  return restored;
}

export interface KeptCheck {
  criterionId: string;
  /** Where the check lived while the run drove it. */
  path: string;
  source: string;
}

/**
 * Read the run's checks out of the tree so the delivery can carry them.
 *
 * A check that cannot be read is dropped rather than recorded empty: an
 * empty source on the record would read as "this criterion was proven by
 * nothing", which is worse than its absence.
 */
export async function keptChecks(
  probes: readonly string[],
  worktree: string,
  criterionByProbe: ReadonlyMap<string, string>,
): Promise<KeptCheck[]> {
  const out: KeptCheck[] = [];
  for (const rel of [...new Set(probes)]) {
    const criterionId = criterionByProbe.get(rel);
    if (!criterionId) continue;
    const source = await fsp.readFile(path.join(worktree, rel), "utf8").catch(() => undefined);
    if (source !== undefined) out.push({ criterionId, path: rel, source });
  }
  return out;
}
