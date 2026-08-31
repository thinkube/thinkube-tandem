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

/** One coverage file as the V8 runtime writes it. */
interface V8Coverage {
  result?: { url?: string; functions?: { ranges?: { count?: number }[] }[] }[];
}

/**
 * Every file the recorded run actually executed a line of — and whether
 * the evidence could be read at all.
 *
 * The difference is the whole verdict. Unreadable coverage used to become
 * an empty list, and an empty list means "the drive executed nothing",
 * which is a statement about the WORK. A directory that could not be
 * listed, a file that could not be read, a shape the parser did not
 * expect: each of them silently accused the code of not running.
 *
 * So absence of evidence is returned as absence of evidence. `read` is
 * false when nothing could be understood, and the caller says "unknown"
 * rather than "no".
 */
async function executedFiles(dir: string): Promise<{ files: string[]; read: boolean }> {
  const out = new Set<string>();
  let understood = 0;
  const names = await fs.readdir(dir).catch(() => undefined);
  if (!names) return { files: [], read: false };
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(dir, n), "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    let parsed: V8Coverage;
    try {
      parsed = JSON.parse(raw) as V8Coverage;
    } catch {
      continue;
    }
    // A coverage file whose shape the parser does not recognise says
    // nothing about the work — it is one more thing that was not read.
    if (!Array.isArray(parsed.result)) continue;
    understood++;
    for (const entry of parsed.result) {
      const url = entry.url ?? "";
      if (!url.startsWith("file://")) continue;
      const ran = (entry.functions ?? []).some((f) => (f.ranges ?? []).some((r) => (r.count ?? 0) > 0));
      if (ran) out.add(url.slice("file://".length));
    }
  }
  return { files: [...out], read: understood > 0 };
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
/** Files a runtime can execute a line of. A document or a data file keeps
 *  a promise by its content, and execution can neither prove nor refute
 *  it — two criteria about a markdown ledger were once red forever because
 *  the trace demanded that a document run. */
const EXECUTABLE = /\.(m|c)?[jt]sx?$|\.(py|rb|go|rs|java|kt|php|cs|swift|scala|ex|exs|sh|lua)$/i;

/**
 * A check that proves its promise by READING files, not by running them.
 *
 * Execution is the right instrument for a promise about behaviour: a stub
 * satisfies an assertion but cannot appear on a path nothing reaches. It is
 * the wrong instrument for a promise about a file's TEXT — that no file
 * exceeds six hundred lines, that a handle "appears literally in the source,
 * reading the source files, not the built bundle". Those are kept by what a
 * file says, and a check proves them by opening it. Demanding execution
 * there fails a check for obeying its own criterion.
 *
 * The same escape already exists one step along, for a subject execution
 * cannot reach at all — a document, a data file. This is that rule keyed on
 * what the CHECK does rather than on the subject's extension.
 */
const READS_FILES = /\b(readFileSync|readdirSync|readFile|opendirSync|globSync|statSync)\b/;

export async function provedByExecution(a: {
  run: string;
  subjects: readonly string[];
  worktree: string;
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  /** The check's own source, when the caller holds it. A check that reads
   *  files keeps its promise by their content; execution can neither prove
   *  nor refute that. */
  probeSource?: string;
}): Promise<WiringVerdict> {
  const runnable = a.subjects.filter((s) => EXECUTABLE.test(s));
  if (!runnable.length)
    return {
      executed: "unknown",
      detail: a.subjects.length
        ? `the promise lands in ${a.subjects.join(", ")} — content, not code; execution cannot prove or refute it, and the check's own verdict stands`
        : "the promise names no file of its own to look for",
    };
  // Asked before the trace is spent: a check that proves its promise by
  // READING its subject cannot be judged by execution, so running it a
  // second time under a recorder buys nothing.
  if (a.probeSource && READS_FILES.test(a.probeSource))
    return {
      executed: "unknown",
      detail:
        `this check proves its promise by READING ${runnable.join(", ")}, not by running them — ` +
        `a criterion about what a file SAYS (its length, a handle appearing literally in it) is kept by ` +
        `the file's text, and execution can neither prove nor refute it.`,
    };
  a = { ...a, subjects: runnable };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tandem-wiring-"));
  try {
    // The recorder is an environment variable of the runtime itself, so a
    // check runs exactly the way it ran when it went green — no flags of
    // ours in its command, nothing about its runner assumed.
    const t0 = Date.now();
    const r = await a.exec(`NODE_V8_COVERAGE='${dir}' ${a.run}`, a.worktree);
    const took = Date.now() - t0;
    const { files: ran, read } = await executedFiles(dir);
    // Nothing to read, or nothing understood: that is a fact about the
    // EVIDENCE, never about the work. Saying "no" here accused the code of
    // not running whenever a directory could not be listed or a coverage
    // file had a shape the parser did not expect.
    if (!read || !ran.length)
      return {
        executed: "unknown",
        detail:
          r.code === 0
            ? "the runtime this check runs under does not report what it executed, so its wiring is unproven"
            : `the check did not pass when re-run for its trace (exit ${r.code ?? "null"}), so nothing was recorded`,
      };
    const hit = a.subjects.filter((s) => ranAmong(s, ran));
    if (hit.length) return { executed: "yes", detail: `the drive executed ${hit.join(", ")}` };
    // The verdict carries its own evidence. Six of these once came back
    // within a single second — execs that plainly never ran a check — and
    // the bare sentence gave a person nothing to notice that with: three
    // hand reproductions said yes while the run said no, and the
    // difference took a day to find. Exit code, duration and what DID
    // execute make the next such disagreement one look instead of an
    // archaeology.
    return {
      executed: "no",
      detail:
        `the drive passed without executing a line of ${a.subjects.join(", ")} — the code this promise lands in. ` +
        `A check that never reaches its subject is green for a stub as readily as for the real thing. ` +
        `(exit ${r.code ?? "null"} in ${took}ms; it did execute: ${ran.slice(0, 5).join(", ")}${ran.length > 5 ? ` and ${ran.length - 5} more` : ""})`,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
