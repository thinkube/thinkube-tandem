/**
 * Hermetic tests for `runBounded` (SP-th4wqc_SL-1) — the bounded, non-interactive AC executor.
 *
 * node:test + node:assert; run via `npm test`. Deterministic by construction: every run injects a
 * small `timeoutMs` and a FIXED scrubbed base env (no ambient PATH, no wall-clock). We never assert
 * on elapsed time — only on the verdict (`{code, output}`), on the process group actually dying
 * (ESRCH on the grandchild), and on PATH resolution under the scrubbed base.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { runBounded } from "./orchestratorCore";

/** Real Node dir, so `node -e` children resolve under our fixed (non-ambient) base PATH. */
const NODE_DIR = path.dirname(process.execPath);
/** A deterministic, minimal base PATH — node + coreutils, NOT `process.env.PATH` wholesale. */
const SCRUBBED_PATH = [NODE_DIR, "/usr/bin", "/bin"].join(path.delimiter);

function mkTmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "acexec-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Liveness of a PID, collapsing "killed" to a single verdict.
 *
 * The AC's intent is that the grandchild is *killed, not orphaned-and-running*. On a reaping init
 * the SIGKILLed orphan vanishes and `process.kill(pid, 0)` throws ESRCH → `"gone"`. But under a
 * non-reaping PID 1 (common in containers/CI), a killed orphan lingers as a defunct **zombie**:
 * `kill(pid, 0)` still "succeeds", yet the process is dead — `/proc/<pid>/stat` reads state `Z`.
 * Both ESRCH and zombie mean "killed"; only a runnable state (`R`/`S`/`D`) means it survived the
 * group kill — exactly the orphan the AC guards against.
 */
function liveness(pid: number): "gone" | "zombie" | "alive" {
  try {
    process.kill(pid, 0); // signal 0 = existence probe, sends nothing
  } catch (err) {
    // ESRCH → reaped/gone. EPERM (or anything else) → it exists beyond our reach: treat as alive.
    return (err as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "alive";
  }
  // Still signalable — disambiguate a dead-but-unreaped zombie from a genuinely-running orphan.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2).trimStart()[0];
    return state === "Z" || state === "X" || state === "x" ? "zombie" : "alive";
  } catch {
    return "gone"; // /proc entry vanished between the two probes → reaped
  }
}

/** Poll until the PID is no longer in a runnable state (gone or zombie). */
async function waitUntilDead(
  pid: number,
): Promise<"gone" | "zombie" | "alive"> {
  let state = liveness(pid);
  for (let i = 0; i < 200 && state === "alive"; i++) {
    await sleep(20);
    state = liveness(pid);
  }
  return state;
}

// ── AC#1: hung command is bounded and group-killed ──────────────────────────────────────────

test("runBounded: a non-terminating child times out → code 124 + 'timed out' marker", async () => {
  const cwd = mkTmpRepo();
  try {
    // `sleep 1000` never returns within the bound; `wait` keeps the shell alive too.
    const res = await runBounded("sleep 1000 & wait", cwd, {
      timeoutMs: 300,
      env: { PATH: SCRUBBED_PATH },
    });
    assert.equal(res.code, 124, "timed-out run resolves with exit code 124");
    assert.match(
      res.output,
      /timed out/i,
      "verdict carries a 'timed out' marker",
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("runBounded: the whole process GROUP is killed — grandchild dies (no orphan)", async () => {
  const cwd = mkTmpRepo();
  const pidFile = path.join(cwd, "grandchild.pid");
  try {
    // The spawned shell (detached → group leader) backgrounds a `sleep` grandchild and records
    // its PID, then waits. A bare `kill(pid)` would orphan the sleep; only a `kill(-pid)` on the
    // whole group reaps it. We assert the group kill happened by probing the grandchild PID.
    const res = await runBounded(
      `sleep 1000 & echo $! > "${pidFile}"; wait`,
      cwd,
      { timeoutMs: 300, env: { PATH: SCRUBBED_PATH } },
    );
    assert.equal(res.code, 124);

    // Wait for the handoff file (written at child start, well before the bound elapses).
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await sleep(20);
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    const grandchildPid = Number.parseInt(raw, 10);
    assert.ok(
      Number.isInteger(grandchildPid) && grandchildPid > 0,
      `grandchild recorded a real PID (got ${JSON.stringify(raw)})`,
    );

    // The AC's check is "process.kill(pid, 0) throws ESRCH on the grandchild". `liveness()` keeps
    // that exact probe as its primary path (→ "gone"), and additionally accepts the dead-but-
    // unreaped zombie a non-reaping PID 1 leaves behind — both mean the group kill worked. The
    // failure the AC guards against is a *runnable* orphan ("alive").
    const state = await waitUntilDead(grandchildPid);
    assert.notEqual(
      state,
      "alive",
      "grandchild sleep was killed by the group kill (ESRCH/gone or zombie), not orphaned-and-running",
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ── AC#2: non-interactive execution (EOF stdin, injected env, repo-local PATH) ───────────────

test("runBounded: child stdin is closed — reads immediate EOF (child asserts 0 bytes)", async () => {
  const cwd = mkTmpRepo();
  try {
    // The child itself reports how many bytes it read from stdin; /dev/null → 'end' with 0 bytes.
    // This proves EOF affirmatively, not merely by absence-of-hang.
    const child =
      `node -e "let n=0;` +
      `process.stdin.on('data',c=>n+=c.length);` +
      `process.stdin.on('end',()=>console.log('STDIN_BYTES='+n))"`;
    const res = await runBounded(child, cwd, {
      timeoutMs: 10_000,
      env: { PATH: SCRUBBED_PATH },
    });
    assert.equal(res.code, 0, "child exits cleanly (no hang)");
    assert.match(
      res.output,
      /STDIN_BYTES=0/,
      "child read zero bytes from a closed stdin",
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("runBounded: child env carries GIT_TERMINAL_PROMPT=0 (non-interactive git)", async () => {
  const cwd = mkTmpRepo();
  try {
    const child = `node -e "console.log('GTP='+process.env.GIT_TERMINAL_PROMPT)"`;
    const res = await runBounded(child, cwd, {
      timeoutMs: 10_000,
      env: { PATH: SCRUBBED_PATH },
    });
    assert.equal(res.code, 0);
    assert.match(
      res.output,
      /GTP=0/,
      "runBounded injects GIT_TERMINAL_PROMPT=0 into the child env",
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("runBounded: a repo-local node_modules/.bin tool resolves; an ambient-only tool does not", async () => {
  const cwd = mkTmpRepo();
  const ambientDir = mkTmpRepo();
  const savedPath = process.env.PATH;
  try {
    // Repo-local toolchain: present ONLY under <cwd>/node_modules/.bin.
    const binDir = path.join(cwd, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
    const localTool = path.join(binDir, "tk-localtool");
    fs.writeFileSync(localTool, "#!/bin/sh\necho TK_LOCAL_OK\n");
    fs.chmodSync(localTool, 0o755);

    // Ambient-only tool: present ONLY in a dir we add to the *process* PATH (the ambient env),
    // never to the scrubbed base we hand runBounded. It must therefore stay unreachable.
    const ambientTool = path.join(ambientDir, "tk-ambienttool");
    fs.writeFileSync(ambientTool, "#!/bin/sh\necho TK_AMBIENT_OK\n");
    fs.chmodSync(ambientTool, 0o755);
    process.env.PATH = [ambientDir, savedPath].join(path.delimiter);

    // runBounded prepends `<cwd>/node_modules/.bin` to the FIXED base PATH (no ambient leak).
    const localRes = await runBounded("tk-localtool", cwd, {
      timeoutMs: 10_000,
      env: { PATH: SCRUBBED_PATH },
    });
    assert.equal(localRes.code, 0, "repo-local tool resolved + ran");
    assert.match(localRes.output, /TK_LOCAL_OK/);

    const ambientRes = await runBounded("tk-ambienttool", cwd, {
      timeoutMs: 10_000,
      env: { PATH: SCRUBBED_PATH },
    });
    assert.notEqual(
      ambientRes.code,
      0,
      "ambient-only tool is NOT found under the scrubbed base PATH",
    );
    assert.doesNotMatch(
      ambientRes.output,
      /TK_AMBIENT_OK/,
      "the ambient tool never ran",
    );
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(ambientDir, { recursive: true, force: true });
  }
});
