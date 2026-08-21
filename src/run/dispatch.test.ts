/**
 * The engine-driven run, end to end over a REAL temporary git repo: the
 * DAG orders tests first, probes are authored in the detached tester
 * snapshot (structural blinding), the REAL verify oracle overlays and
 * grades the coder's work (MANDATORY-GREEN + rework), probes persist in
 * the oracle store and ride the branch, the REAL closing gate executes
 * them, and the delivery carries honest proofs. Parking, containment and
 * the parallel frontier are covered at their seams.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { containmentViolations } from "./worker";
import { renderTepBody } from "./briefs";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo, writeInto } from "./runHarness";

test("a signed TEP runs through the engine: tests-first, blinded tester, oracle-confirmed green, honest proofs", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-1" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const briefs: { role: string; text: string }[] = [];
  const trees: Record<string, string> = {};
  let probeVisibleToCoder: boolean | undefined;

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      digest: "CONVENTIONS: greetings are lowercase; tests sit beside the code",
      worker: async (w, brief) => {
        briefs.push({ role: w.role, text: brief });
        trees[w.role] = w.worktree;
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        } else {
          // Structural blinding: the probe the tester wrote must NOT exist
          // in the coder's tree at dispatch time.
          probeVisibleToCoder = fs.existsSync(
            path.join(w.worktree, slices[0].workUnits.find((u) => u.role === "test")!.footprint[0]),
          );
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  assert.equal(briefs[0].role, "test", "tests-first: the probe author dispatched before the coder");
  assert.ok(briefs[0].text.includes("TEST AUTHOR"), "engine brief for the tester");
  assert.ok(briefs[1].text.includes("SERIAL unit"), "engine brief for the coder");
  assert.ok(briefs[1].text.includes("THE INTENT"), "the TEP body rides the brief as the north star");
  assert.ok(briefs[1].text.includes("verify"), "the coder is told about the in-loop verify tool");
  assert.ok(
    briefs.every((b) => b.text.includes("greetings are lowercase")),
    "the repository's reading reaches every worker — the only actors that MAKE changes",
  );

  assert.notEqual(trees.test, trees.code, "tester and coder work in different trees");
  assert.equal(probeVisibleToCoder, false, "blinding is structural: no probe in the coder's tree");

  assert.ok(outcome.delivery, "a delivery exists");
  const probeProof = outcome.delivery!.proofs.find((p) => p.kind === "probe")!;
  assert.equal(probeProof.verdict, "green", "the REAL closing gate executed the probe");
  const suiteProof = outcome.delivery!.proofs.find((p) => p.kind === "suite")!;
  assert.equal(suiteProof.verdict, "green");
  assert.equal(outcome.undelivered.length, 0);
  const states = [...state.units.values()].map((u) => u.state);
  assert.ok(states.every((s) => s === "done"));

  // The probes persisted in the oracle store and ride the branch.
  const store = path.join(path.dirname(repo), `${path.basename(repo)}-worktrees`, "oracle-store", "TEP-t-1");
  const probeRel = slices[0].workUnits.find((u) => u.role === "test")!.footprint[0];
  assert.ok(fs.existsSync(path.join(store, "files", probeRel)), "probe persisted in the oracle store");
  const shipped = execFileSync(
    "git",
    ["-C", repo, "ls-tree", "-r", "--name-only", "tandem/TEP-t-1"],
    { encoding: "utf8" },
  );
  assert.ok(shipped.includes(probeRel), "the probe is committed on the delivery branch");
  assert.ok(shipped.includes("src/greet.mjs"), "the implementation is committed on the delivery branch");
});

test("the dispatcher's call site threads the rendered TEP body under a single field: it rides both the coder's and the tester's brief exactly once", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-2" };
  const tepBody = renderTepBody(space, cut);
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const briefs: Record<string, string> = {};

  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        briefs[w.role] = brief;
        if (w.role === "test") writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        else writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  const escaped = tepBody.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "g");
  assert.equal(
    (briefs.code.match(re) ?? []).length,
    1,
    "the rendered TEP body must ride the coder's brief exactly once",
  );
  assert.equal(
    (briefs.test.match(re) ?? []).length,
    1,
    "the rendered TEP body must ride the tester's brief exactly once",
  );
});

test("standing checks re-home: the outcome carries each criterion's forwarding address, stamped", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-9" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let rehomeSaw: { criterionId: string; check: string; lands: string[] } | undefined;

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async (args) => {
        const c = args.checks[0];
        rehomeSaw = { criterionId: c.criterionId, check: c.check, lands: c.lands };
        return {
          anchors: [{ criterionId: c.criterionId, path: "src/greet.test.mjs", test: "greet returns the greeting" }],
          notes: [],
        };
      },
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        else writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  assert.equal(rehomeSaw?.criterionId, "c1", "the check's identity reaches the re-homer from the space");
  assert.equal(rehomeSaw?.check, "greet() returns 'hello'", "with the criterion's words");
  assert.deepEqual(rehomeSaw?.lands, ["src/greet.mjs"], "and where its promise lands");
  const anchor = outcome.proofAnchors![0];
  assert.equal(anchor.criterionId, "c1");
  assert.equal(anchor.path, "src/greet.test.mjs");
  const head = execFileSync("git", ["-C", repo, "rev-parse", "tandem/TEP-t-9"], { encoding: "utf8" }).trim();
  assert.equal(anchor.stamp[0].head, head, "the binding is stamped at the delivered head — drift is detectable");
  const probeProof = outcome.delivery!.proofs.find((p) => p.kind === "probe")!;
  assert.equal(probeProof.criterionId, "c1", "every gate proof names the check it answers");
});

test("MANDATORY-GREEN: a wrong implementation is not done — the oracle's evidence routes a rework that fixes it", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-4" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let codeAttempts = 0;
  let reworkBrief: string | undefined;

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        codeAttempts++;
        if (codeAttempts === 1) {
          // Claims done, but the work is wrong — the self-report must count
          // for nothing.
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hola"; }\n`);
        } else {
          reworkBrief = brief;
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  assert.equal(codeAttempts, 2, "the oracle's red verdict routed exactly one rework");
  assert.ok(reworkBrief!.includes("REWORK"), "the rework brief names itself");
  assert.ok(reworkBrief!.includes("PROBES:"), "the oracle's evidence rides the rework brief");
  assert.equal(outcome.undelivered.length, 0);
  const probeProof = outcome.delivery!.proofs.find((p) => p.kind === "probe")!;
  assert.equal(probeProof.verdict, "green", "after rework the closing gate is green");
});

test("the in-loop verify tool grades the coder's current work against the real probes", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-5" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let replyWrong: string | undefined;
  let replyRight: string | undefined;

  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        assert.ok(w.verifyTool, "the coder has the verify tool");
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hola"; }\n`);
        replyWrong = await w.verifyTool!();
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        replyRight = await w.verifyTool!();
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );

  assert.ok(replyWrong!.includes("0/1 pass") || replyWrong!.includes("FAIL"), "wrong work reads FAIL with evidence");
  assert.ok(replyRight!.includes("1/1 pass"), "fixed work reads PASS");
});

test("a red probe is a red proof — the delivery exists and says so", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-2" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(
            w.worktree,
            w.footprint[0],
            `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
              `test("fails", () => assert.equal(1, 2));\n`,
          );
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  const probeProof = outcome.delivery!.proofs.find((p) => p.kind === "probe")!;
  assert.equal(probeProof.verdict, "red");
  assert.ok(probeProof.ref, "evidence rides the proof");
  assert.ok(
    outcome.undelivered.some((u) => u.includes("not green")),
    "the never-green coder unit is UNDELIVERED, not silently done",
  );
});

test("independent slices run on the parallel frontier — two probe authors in flight at once", async () => {
  const repo = tmpRepo();
  let s = emptySpace();
  const a = addAsk(s, "two independent modules", "t");
  assert.ok(a.ok);
  s = a.space;
  const ids: string[] = [];
  for (const name of ["alpha", "beta"]) {
    const n = addNode(s, {
      sentence: `the ${name} module`,
      serves: [a.added.id],
      needs: [],
      acceptance: [{ id: `c-${name}`, text: `${name}() returns '${name}'` }],
      grounding: { touchpoints: [{ path: `src/${name}.mjs`, planned: true }], stamp: [] },
    });
    assert.ok(n.ok);
    s = n.space;
    ids.push(n.added.id);
  }
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-6" };
  const slices = tepSlices({ space: s, cut, spaceName: "pair space" });
  assert.equal(slices.length, 2, "two independent changes form two slices");
  const state = new RunState(() => {});
  let inflight = 0;
  let maxInflight = 0;

  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "pair space",
      concurrency: 2,
      worker: async (w) => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 20));
        const name = w.footprint[0].includes("SL-1") || w.footprint[0].includes("alpha") ? "alpha" : "beta";
        if (w.role === "test") {
          writeInto(
            w.worktree,
            w.footprint[0],
            `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
              `import { ${name} } from "../src/${name}.mjs";\n` +
              `test("${name}", () => assert.equal(${name}(), "${name}"));\n`,
          );
        } else {
          writeInto(w.worktree, `src/${name}.mjs`, `export function ${name}() { return "${name}"; }\n`);
        }
        inflight--;
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );

  assert.ok(maxInflight >= 2, `the frontier pump ran units concurrently (saw ${maxInflight})`);
  assert.equal([...state.units.values()].filter((u) => u.state !== "done").length, 0);
});

test("parked worker: the question surfaces, the answer resumes, UNDELIVERED is honest", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-3" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let seenAnswer: string | undefined;
  // Answer through the same door the run view uses, the moment the park lands.
  const origPark = state.park.bind(state);
  state.park = (id, q, answer) => {
    origPark(id, q, answer);
    setImmediate(() => state.answer(id, "hello"));
  };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          const answer = await new Promise<string>((resolve) => w.onPark("which greeting?", resolve));
          seenAnswer = answer;
          return { ok: false, finalText: "UNDELIVERED: could not finish — question: which greeting?", undelivered: ["could not finish — question: which greeting?"] };
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.equal(seenAnswer, "hello", "the answer flowed through the run view door");
  assert.ok(outcome.undelivered.some((u) => u.includes("could not finish")), "the gap is on the delivery, not hidden");
});

test("containment math: outside-footprint paths are violations; baseline is exempt", () => {
  const dirty = ["src/a.ts", "src/evil.ts", "probes/x.test.mjs", "pre-existing.txt"];
  const bad = containmentViolations(dirty, ["src/a.ts", "probes"], new Set(["pre-existing.txt"]));
  assert.deepEqual(bad, ["src/evil.ts"]);
});

test("the supervisor's pre-flight disclosure rides the coder's brief, and a DISCLOSE is ledgered as a defect", async () => {
  const repo = tmpRepo();
  const ledger = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ledger-"));
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-10" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let coderBrief: string | undefined;
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      storeDir: ledger,
      supervisorRound: async (_d, prompt) => {
        assert.ok(prompt.includes("RUN SUPERVISOR"), "the supervisor doctrine rides the prompt");
        return "DISCLOSE: the check expects the exact literal 'hello'.";
      },
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        } else {
          coderBrief = brief;
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        }
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.ok(coderBrief!.includes("SUPERVISOR PRE-FLIGHT"), "the disclosure reached the brief");
  assert.ok(coderBrief!.includes("exact literal 'hello'"));
  const defectDir = path.join(ledger, "defects");
  const rows = fs
    .readdirSync(defectDir)
    .flatMap((f) => fs.readFileSync(path.join(defectDir, f), "utf8").trim().split("\n"));
  assert.ok(
    rows.some((r) => r.includes("DISCLOSE") && r.includes("supervisor")),
    "the disclosure is a ledgered contract gap",
  );
  const record = JSON.parse(
    fs.readFileSync(path.join(ledger, "deliveries", "TEP-t-10.json"), "utf8"),
  );
  assert.equal(record.tep, "TEP-t-10");
  assert.ok(Array.isArray(record.trace) && record.trace.length > 0, "the engine's verification trace persisted as the machine face");
});

test("the tester's decisions ride the coder's brief as contract and land on the delivery", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-32" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let coderBrief = "";
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "probes written\nDECISION: greet is exported as a named function `greet` from src/greet.mjs" };
        }
        coderBrief = brief;
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.ok(coderBrief.includes("TESTER'S DECISIONS") && coderBrief.includes("named function `greet`"), "the coder builds to the tester's choices");
  assert.deepEqual(
    outcome.delivery?.decisions?.map((d) => d.text),
    ["greet is exported as a named function `greet` from src/greet.mjs"],
    "recorded on the delivery — visible, never asked",
  );
});

test("a crash inside one unit fails that unit on the record — the run goes on and reaches the gate", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-36" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") throw new Error("the snapshot vanished under the author");
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  const tester = slices[0].workUnits.findIndex((u) => u.role === "test");
  const testerId = `SL-1#eu-${tester}`;
  assert.equal(state.view().units.find((u) => u.id === testerId)?.state, "failed", "the crashed unit is failed, not left running");
  assert.ok(outcome.undelivered.some((u) => u.includes("crashed") && u.includes("snapshot vanished")), "the cause is on the record");
  assert.ok(state.logs.some((l) => l.includes("closing gate")), "the run reached its gate");
});

test("a build that fails only in files another slice owns is the tree's failure, not this coder's: the unit waits for the next commit and is graded again", async () => {
  const repo = tmpRepo();
  // Two independent promises; a "build" that fails until slice 1's file exists.
  let s = emptySpace();
  const a = addAsk(s, "two things", "t");
  if (!a.ok) throw new Error("ask");
  s = a.space;
  const n1 = addNode(s, {
    sentence: "a greet module", serves: [a.added.id], servesClaim: "c-1", needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  if (!n1.ok) throw new Error("n1");
  s = n1.space;
  const n2 = addNode(s, {
    sentence: "a wave module", serves: [a.added.id], servesClaim: "c-2", needs: [],
    acceptance: [{ id: "c2", text: "wave() returns 'wave'" }],
    grounding: { touchpoints: [{ path: "src/wave.mjs", planned: true }], stamp: [] },
  });
  if (!n2.ok) throw new Error("n2");
  s = n2.space;
  const cut = { id: "cut-1", changeIds: [n1.added.id, n2.added.id], tepId: "TEP-t-51" };
  const slices = tepSlices({ space: s, cut, spaceName: "two" });
  const state = new RunState(() => {});
  let waited = false;
  let releaseGreet: () => void = () => {};
  const greetMayFinish = new Promise<void>((r) => (releaseGreet = r));
  const origLog = state.log.bind(state);
  state.log = (line, step) => {
    origLog(line, step);
    if (line.includes("waiting for another slice to land")) {
      waited = true;
      releaseGreet();
    }
  };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      // The build fails, naming src/greet.mjs, when wave.mjs exists but greet.mjs
      // does not yet — slice 2's runner sees exactly that until slice 1 lands.
      prepare: "if [ -f src/wave.mjs ] && [ ! -f src/greet.mjs ]; then echo 'src/greet.mjs(1,1): error TS0: not built yet'; exit 1; fi",
      state,
      concurrency: 4,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "two",
      worker: async (w) => {
        if (w.role === "test") {
          const probe = w.footprint[0].includes("SL-1")
            ? GREEN_PROBE
            : GREEN_PROBE.replace(/greet/g, "wave").replace("'hello'", "'wave'").replace('"hello"', '"wave"');
          writeInto(w.worktree, w.footprint[0], probe);
          return { ok: true, finalText: "done" };
        }
        if (w.footprint.includes("src/greet.mjs")) {
          // Slice 1's coder is slow: it lands only after slice 2 has waited once.
          await Promise.race([greetMayFinish, new Promise((r) => setTimeout(r, 20000))]);
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/wave.mjs", `export function wave() { return "wave"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.ok(waited, "slice 2 waited for the tree instead of being charged a rework");
  const wave = state.view().units.find((u) => u.role === "code" && u.slice === "SL-2")!;
  assert.equal(wave.state, "done", "and went green once slice 1 landed");
  assert.ok(outcome.delivery, "the run delivers");
});
