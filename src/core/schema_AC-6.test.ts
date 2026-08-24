/**
 * TRANSITION — the run's identity moves into one small module of its own,
 * so dispatch.ts (already one line short of the repository's module-size
 * gate) never has to grow to hold the mint and its comment, and every
 * reader of a run's identity — the run log heading, the defect rows, the
 * delivery — takes it from that one place instead of two independent
 * spellings drifting apart. Its job is done once the mint has moved and
 * every reader agrees on one run identity for one run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { dispatchTep, runStamp } from "../run/dispatch";
import { closeGate } from "../run/gate";
import { RunState } from "../run/state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "./schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "../run/shapes";
import type { RepoShape } from "../run/shapes";

const repo = path.resolve(__dirname, "..", "..");
const SIZE_LIMIT = 600;

function oneAsk(): { space: ReturnType<typeof emptySpace>; ids: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, ids: [n.added.id] };
}

test("no source file in the repository exceeds its module-size limit after this work", () => {
  // src/hygiene.test.ts already enforces this repository-wide, but it lives
  // outside this unit's footprint — repeated here as the change's own
  // acceptance criterion so the change cannot ship leaving dispatch.ts (one
  // line short of the limit today) grown over it.
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (["node_modules", "out", "out-test", "media", "engine", ".git"].includes(name)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const lines = fs.readFileSync(p, "utf8").split("\n").length;
        if (lines > SIZE_LIMIT) offenders.push(`${path.relative(repo, p)}: ${lines}`);
      }
    }
  };
  walk(path.join(repo, "src"));
  if (fs.existsSync(path.join(repo, "webview", "map", "src"))) walk(path.join(repo, "webview", "map", "src"));
  assert.deepEqual(offenders, []);

  // Staying under the limit is only half the promise. A file can shed lines
  // by dropping the seam its readers need, which is the one way of passing
  // the size rule that the size rule must not reward. So the two files this
  // promise lands in are driven here, not merely counted: dispatch.ts must
  // still serve the mint, and gate.ts must still be the module that carries
  // a stamp onto a delivery.
  const at = Date.parse("2026-08-24T10:00:00.000Z");
  const stamp = runStamp("TEP-size", at);
  assert.equal(stamp.id.includes("TEP-size"), true, `dispatch.ts no longer serves the mint: ${JSON.stringify(stamp)}`);
  assert.equal(stamp.at, "2026-08-24T10:00:00.000Z", `dispatch.ts's mint lost the produced-at time: ${JSON.stringify(stamp)}`);
});

test("the closing gate carries the stamp it is given onto the delivery it builds", async () => {
  // gate.ts is driven, never merely named. A reference that only asks
  // whether the export is a function executes no line of the module's body,
  // so it is satisfied by a stub as readily as by the real gate — the exact
  // reading the wiring trace exists to refuse. This runs the gate over a
  // real tree and reads the stamp off what it returns.
  const shape = SHAPES[0] as RepoShape;
  const worktree = repoInShape(shape);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-gate-stamp" };
  const stamp = runStamp(cut.tepId, Date.parse("2026-08-24T10:00:00.000Z"));
  const state = new RunState(() => {});
  // The run's own exec reports a command's exit code; it never throws. A
  // stub that throws would end the drive at the first `git push` to a
  // fixture with no remote, before the gate ever built its delivery.
  const exec = async (cmd: string, args: string[], cwd: string) => {
    try {
      const out = execFileSync(cmd, args, { cwd, encoding: "utf8" as const, stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, out, err: "" };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? String(err) };
    }
  };

  const outcome = await closeGate({
    tep: cut.tepId,
    runId: stamp.id,
    producedAt: stamp.at,
    branch: `tandem/${cut.tepId}`,
    baseSha: (await exec("git", ["-C", worktree, "rev-parse", "HEAD"], worktree)).out.trim(),
    worktree,
    slices: tepSlices({ space, cut, spaceName: "delivers" }),
    space,
    cut,
    deps: { repoRoot: worktree, model: "sonnet", suiteCommand: ["node", "-e", "process.exit(0)"], storeDir: store },
    sliceProbes: new Map(),
    sliceCommitted: new Set(),
    checkOf: new Map(),
    undelivered: [],
    rulings: [],
    decisions: [],
    exec,
    boundedExec: async () => ({ code: 0, output: "" }),
    suiteExec: async () => ({ code: 0, output: "" }),
    state,
    sessionOf: () => undefined,
    worker: (async () => ({ ok: true })) as never,
    machineAttention: () => 0,
    log: () => {},
    defect: () => {},
  } as never);

  const d = outcome.delivery as unknown as { runId?: string; producedAt?: string } | undefined;
  assert.ok(d, "the closing gate produced no delivery to carry a stamp");
  assert.equal(d!.runId, stamp.id, `gate.ts did not carry the run id onto the delivery: ${JSON.stringify(d)}`);
  assert.equal(d!.producedAt, stamp.at, `gate.ts did not carry the produced-at time onto the delivery: ${JSON.stringify(d)}`);
});

test("one run's identity is spelled identically in the run log heading, the defect rows and the delivery", async () => {
  const shape = SHAPES[0] as RepoShape;
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const repoDir = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-onemint" };
  const outcome = await dispatchTep(
    {
      repoRoot: repoDir,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      storeDir: wtRoot,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the run opened a delivery");
  const runId = (outcome.delivery as unknown as { runId?: string }).runId;
  assert.ok(runId, "the delivery names the run that produced it");

  const logPath = path.join(wtRoot, "runs", `${cut.tepId}.log`);
  const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  assert.ok(logText.length > 0, `no run log was written to ${logPath}`);
  assert.match(
    logText,
    new RegExp(`──── ${runId!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ────`),
    `the run log heading does not carry the same run identity as the delivery: ${logText.slice(0, 200)}`,
  );

  const defectsDir = path.join(wtRoot, "defects");
  const defectFiles = fs.existsSync(defectsDir) ? fs.readdirSync(defectsDir) : [];
  const defectRows = defectFiles
    .flatMap((f) => fs.readFileSync(path.join(defectsDir, f), "utf8").split("\n").filter(Boolean))
    .map((l) => JSON.parse(l) as { run?: string; spec?: string });
  const forThisRun = defectRows.filter((r) => r.spec === cut.tepId);
  for (const row of forThisRun)
    assert.equal(row.run, runId, `a defect row spells the run identity differently: ${JSON.stringify(row)}`);
});
