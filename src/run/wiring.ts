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

/** Where a file says its source map lives, if it says. */
function mapRefOf(text: string): string | undefined {
  // The last such comment wins, as the runtime resolves it.
  const refs = [...text.matchAll(/\/[/*]#\s*sourceMappingURL=([^\s*]+)/g)];
  return refs.length ? refs[refs.length - 1][1] : undefined;
}

/**
 * The original files a bundle inlines, as its source map names them.
 *
 * A bundler compiles many modules into one file, and V8 records only the
 * file it executed. Under a bundle the originals attribute to nothing, so
 * a promise landing in a bundled module reads as never executed however
 * thoroughly the drive ran it. The source map is the only record of which
 * originals that one file is made of.
 *
 * Absent, unreadable or malformed map: nothing is credited. This may only
 * ever ADD what genuinely ran, never invent it.
 */
async function inlinedSources(file: string): Promise<string[]> {
  const text = await fs.readFile(file, "utf8").catch(() => "");
  if (!text) return [];
  const ref = mapRefOf(text);
  if (!ref) return [];
  let mapText: string;
  const inline = /^data:application\/json[^,]*;base64,(.*)$/.exec(ref);
  if (inline) {
    mapText = Buffer.from(inline[1], "base64").toString("utf8");
  } else if (/^data:/.test(ref)) {
    mapText = decodeURIComponent(ref.slice(ref.indexOf(",") + 1));
  } else {
    mapText = await fs.readFile(path.resolve(path.dirname(file), ref), "utf8").catch(() => "");
  }
  if (!mapText) return [];
  let map: { sources?: unknown; sourceRoot?: unknown };
  try {
    map = JSON.parse(mapText) as { sources?: unknown; sourceRoot?: unknown };
  } catch {
    return [];
  }
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const root = typeof map.sourceRoot === "string" ? map.sourceRoot : "";
  const base = path.dirname(file);
  return sources
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => {
      const joined = root ? `${root.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}` : s;
      const bare = joined.startsWith("file://") ? joined.slice("file://".length) : joined;
      return path.isAbsolute(bare) ? bare : path.resolve(base, bare);
    });
}

/**
 * Every file the recorded run actually executed a line of — including the
 * originals a bundle inlines, which V8 cannot name on its own.
 */
async function executedFiles(dir: string): Promise<string[]> {
  const out = new Set<string>();
  const ranFiles = new Set<string>();
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
      if (ran) {
        const file = url.slice("file://".length);
        out.add(file);
        ranFiles.add(file);
      }
    }
  }
  // Only files that actually ran are asked what they are made of, so this
  // credits the originals behind executed code and nothing else.
  for (const file of ranFiles) {
    for (const src of await inlinedSources(file)) out.add(src);
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
/** Files a runtime can execute a line of. A document or a data file keeps
 *  a promise by its content, and execution can neither prove nor refute
 *  it — two criteria about a markdown ledger were once red forever because
 *  the trace demanded that a document run. */
const EXECUTABLE = /\.(m|c)?[jt]sx?$|\.(py|rb|go|rs|java|kt|php|cs|swift|scala|ex|exs|sh|lua)$/i;

export async function provedByExecution(a: {
  run: string;
  subjects: readonly string[];
  worktree: string;
  exec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
}): Promise<WiringVerdict> {
  const runnable = a.subjects.filter((s) => EXECUTABLE.test(s));
  if (!runnable.length)
    return {
      executed: "unknown",
      detail: a.subjects.length
        ? `the promise lands in ${a.subjects.join(", ")} — content, not code; execution cannot prove or refute it, and the check's own verdict stands`
        : "the promise names no file of its own to look for",
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
    const ran = await executedFiles(dir);
    if (!ran.length)
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
