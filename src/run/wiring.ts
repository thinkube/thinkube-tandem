/**
 * Wiring proven by execution.
 *
 * The failure this exists for: seven checks green over a register that was
 * built, disposed, and connected to nothing. Every assertion held. Nothing
 * called the code. A stub satisfies an assertion; it cannot appear on the
 * execution path of a drive that never reaches it.
 *
 * So a green check is asked one more question — did running you actually
 * execute the code this promise lands in? — and the answer comes from the
 * runtime, not from anybody's account of it. The check is run again with
 * the runtime recording what it executed; the promise's own files are then
 * looked for in that record.
 *
 * What this does NOT do is guess. When the runtime a check runs under
 * cannot report what it executed, the answer is **unknown**, said plainly
 * and carried onto the delivery — never a pass, and never a failure
 * charged to a coder for the machine's own blindness.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

type Executed = "yes" | "no" | "unknown";

export interface WiringVerdict {
  executed: Executed;
  /** What was looked at, in a reader's words. */
  detail: string;
}

/** The extensions V8 can report execution for. A subject outside this set is
 *  data, not code: it is read by a drive, never executed, so coverage can
 *  never name it and its absence proves nothing about the drive's reach. */
const EXECUTABLE_EXT_RE = /\.(m|c)?[jt]sx?$/;

/** Is this subject a file a runtime can execute a line of at all? */
export function isExecutableSubject(subject: string): boolean {
  return EXECUTABLE_EXT_RE.test(subject);
}

/** One coverage file as the V8 runtime writes it. */
interface V8Coverage {
  result?: { url?: string; functions?: { ranges?: { count?: number }[] }[] }[];
}

/** Every file the recorded run actually executed a line of. */
async function executedFiles(dir: string): Promise<string[]> {
  const out = new Set<string>();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(dir, n), "utf8").catch(() => "");
    let parsed: V8Coverage;
    try {
      parsed = JSON.parse(raw) as V8Coverage;
    } catch {
      continue;
    }
    for (const entry of parsed.result ?? []) {
      const url = entry.url ?? "";
      if (!url.startsWith("file://")) continue;
      const ran = (entry.functions ?? []).some((f) => (f.ranges ?? []).some((r) => (r.count ?? 0) > 0));
      if (ran) out.add(url.slice("file://".length));
    }
  }
  return [...out];
}

/**
 * Does this file's work appear in what the run executed?
 *
 * Matched by the path the repository knows it as, ignoring where the build
 * put it: a source at `src/a/b.ts` may execute as `out/a/b.js`, and both
 * are the same promise's code.
 */
export function ranAmong(subject: string, executed: readonly string[]): boolean {
  const stem = subject.replace(/\.[^./]+$/, "");
  const tail = stem.split("/").filter(Boolean);
  return executed.some((e) => {
    const parts = e.replace(/\.[^./]+$/, "").split("/").filter(Boolean);
    // The last segments must agree — `.../out/a/b` matches `src/a/b`.
    for (let take = Math.min(tail.length, parts.length); take >= 1; take--) {
      if (tail.slice(-take).join("/") === parts.slice(-take).join("/") && take >= 1 && tail[tail.length - 1] === parts[parts.length - 1])
        return true;
    }
    return false;
  });
}

/**
 * Run one check with the runtime recording what it executes, and say
 * whether the promise's own files were on that path.
 *
 * `exec` is the run's own bounded runner, so a check that hangs here ends
 * the way every other command does.
 */
export async function provedByExecution(a: {
  run: string;
  subjects: readonly string[];
  worktree: string;
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
}): Promise<WiringVerdict> {
  if (!a.subjects.length) return { executed: "unknown", detail: "the promise names no file of its own to look for" };
  // Only code can appear in an execution record. A promise landing in data —
  // a ledger, a manifest, a document — is read by its drive, so coverage
  // cannot speak to its reach either way, and silence here is not evidence.
  const codeSubjects = a.subjects.filter(isExecutableSubject);
  if (!codeSubjects.length)
    return {
      executed: "unknown",
      detail:
        `${a.subjects.join(", ")} is data, not code: a drive reads it rather than executing it, ` +
        `so an execution record can never name it and its wiring is unproven here.`,
    };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tandem-wiring-"));
  try {
    // The recorder is an environment variable of the runtime itself, so a
    // check runs exactly the way it ran when it went green — no flags of
    // ours in its command, nothing about its runner assumed.
    const r = await a.exec(`NODE_V8_COVERAGE='${dir}' ${a.run}`, a.worktree);
    const ran = await executedFiles(dir);
    if (!ran.length)
      return {
        executed: "unknown",
        detail:
          r.code === 0
            ? "the runtime this check runs under does not report what it executed, so its wiring is unproven"
            : `the check did not pass when re-run for its trace (exit ${r.code ?? "null"}), so nothing was recorded`,
      };
    const hit = codeSubjects.filter((s) => ranAmong(s, ran));
    if (hit.length) return { executed: "yes", detail: `the drive executed ${hit.join(", ")}` };
    return {
      executed: "no",
      detail:
        `the drive passed without executing a line of ${codeSubjects.join(", ")} — the code this promise lands in. ` +
        `A check that never reaches its subject is green for a stub as readily as for the real thing.`,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
