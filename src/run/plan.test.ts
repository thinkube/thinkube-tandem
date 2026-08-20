/**
 * The plan-side obligations proved through the run: a documentation
 * touchpoint that never lands is UNDELIVERED on the delivery, and a
 * delivered confession marker is UNDELIVERED on its face — both read from
 * the delivered tree at the gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dispatchTep } from "./dispatch";
import { sliceBookkeeping } from "./plan";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace, Space } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo, writeInto } from "./runHarness";

test("docs gate: a slice declaring a docs/ touchpoint that never lands is UNDELIVERED on the delivery", async () => {
  const repo = tmpRepo();
  let s = emptySpace();
  const a = addAsk(s, "document the greeting", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a guide page for the greeting",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the guide exists" }],
    grounding: {
      touchpoints: [{ path: "docs/guide.md", planned: true }],
      stamp: [],
    },
  });
  assert.ok(n.ok);
  const cut = { id: "cut-1", changeIds: [n.added.id], tepId: "TEP-t-7" };
  const slices = tepSlices({ space: n.space, cut, spaceName: "docs space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "docs space",
      worker: async (w) => {
        // The probe passes trivially; the coder never writes the guide.
        if (w.role === "test")
          writeInto(
            w.worktree,
            w.footprint[0],
            `import { test } from "node:test";\ntest("t", () => {});\n`,
          );
        return { ok: true, finalText: "done" };
      },
    },
    n.space,
    cut,
    slices,
  );
  assert.ok(
    outcome.undelivered.some((u) => u.includes("docs obligation unmet")),
    "the engine's docs gate speaks on the delivery",
  );
});


test("the honesty scan: a delivered confession marker is UNDELIVERED on the delivery's face", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-9" };
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
        if (w.role === "test") writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
        else
          writeInto(
            w.worktree,
            "src/greet.mjs",
            `// !DEFERRAL_T!: handle non-English greetings\nexport function greet() { return "hello"; }\n`.replace("!DEFERRAL_T!", "TO" + "DO"),
          );
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.ok(
    outcome.undelivered.some((u) => u.includes("confesses a deferral")),
    "the confession surfaced as UNDELIVERED, not a footnote",
  );
});

test("a tester that stops short is continued from where it stopped — its written probes stay, the missing ones are named, the unit is not failed", async () => {
  const repo = tmpRepo();
  let s = emptySpace();
  const a = addAsk(s, "greet twice", "t");
  if (!a.ok) throw new Error("ask");
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [
      { id: "c1", text: "greet() returns 'hello'" },
      { id: "c2", text: "greet() is a function" },
    ],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  if (!n.ok) throw new Error("node");
  s = n.space;
  const cut = { id: "cut-1", changeIds: [n.added.id], tepId: "TEP-t-61" };
  const slices = tepSlices({ space: s, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const briefs: string[] = [];
  let testerRounds = 0;
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
          testerRounds++;
          briefs.push(brief);
          // Round one writes only the first probe and ends; the continuation writes the rest.
          const todo = testerRounds === 1 ? [w.footprint[0]] : w.footprint.filter((f) => !fs.existsSync(path.join(w.worktree, f)));
          for (const f of todo) writeInto(w.worktree, f, GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.equal(testerRounds, 2, "one continuation");
  assert.match(briefs[1], /CONTINUE/);
  assert.match(briefs[1], /STILL TO WRITE/);
  assert.equal(state.view().units.find((u) => u.role === "test")?.state, "done");
  assert.ok(outcome.delivery, "and the run delivers");
});

test("a slice's test homes are brought under by its maintainer, in the code tree, after the code they import has landed — and the run delivers", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "greet.test.mjs"), "// the old signing test\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "an existing test home"]);
  let s = emptySpace();
  const a = addAsk(s, "greet, and bring the old test under", "t");
  if (!a.ok) throw new Error("ask");
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module, and its existing test brought under",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }, { path: "src/greet.test.mjs" }], stamp: [] },
  });
  if (!n.ok) throw new Error("node");
  s = n.space;
  const cut = { id: "cut-1", changeIds: [n.added.id], tepId: "TEP-t-71" };
  const slices = tepSlices({ space: s, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const order: string[] = [];
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      // The graph: the test home imports greet.mjs.
      affected: async (p) => (p === "src/greet.mjs" ? "- greet.test.mjs [imports_from] src/greet.test.mjs:L1" : ""),
      worker: async (w, brief) => {
        if (w.role === "test" && w.footprint[0].startsWith("probes/")) {
          order.push("tester");
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        if (w.role === "test") {
          order.push("maintainer");
          assert.match(brief, /EXISTING TEST HOMES YOU OWN/, "the maintainer is briefed as a tester on its homes");
          assert.ok(fs.existsSync(path.join(w.worktree, "src", "greet.mjs")), "the code it imports is already there");
          writeInto(w.worktree, "src/greet.test.mjs", "// brought under: greet() returns 'hello'\n");
          return { ok: true, finalText: "done" };
        }
        order.push("coder");
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.deepEqual(order, ["tester", "coder", "maintainer"], "probes first, then the code, then the test homes brought under");
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the run delivers");
});

test("a check whose words name a maintainer's test home is homed on the maintainer at planning; one whose probe reads it anyway is transferred at verify — the coder is green of its own, on the record", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "greet.test.mjs"), "// the old header\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "an existing test home"]);
  let s = emptySpace();
  const a = addAsk(s, "greet, and fix the old test's header", "t");
  if (!a.ok) throw new Error("ask");
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module, and the old test's header brought under",
    serves: [a.added.id],
    needs: [],
    acceptance: [
      { id: "c1", text: "greet() returns 'hello'" },
      // Named home → homed on the maintainer at planning.
      { id: "c2", text: "src/greet.test.mjs no longer claims the old header" },
      // Unnamed, but its probe will read the home → transferred at verify.
      { id: "c3", text: "the old test is brought under the new rule" },
    ],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }, { path: "src/greet.test.mjs" }], stamp: [] },
  });
  if (!n.ok) throw new Error("node");
  s = n.space;
  const cut = { id: "cut-1", changeIds: [n.added.id], tepId: "TEP-t-72" };
  const slices = tepSlices({ space: s, cut, spaceName: "greet space" });

  // Planning: the named check leaves the parent and stays with the maintainer.
  const books = sliceBookkeeping(slices);
  assert.equal(books.rehomed.length, 1, "one check is homed on the maintainer at planning");
  assert.equal(books.rehomed[0].ac, 2);
  assert.match(books.rehomed[0].check, /greet\.test\.mjs/);
  assert.ok(!books.sliceVerifs.get("SL-1")!.some((v) => v.ac === 2), "the parent's coder is not graded on it");
  assert.ok(books.sliceVerifs.get("SL-1-tests")!.some((v) => v.ac === 2), "the maintainer is");
  assert.ok(
    books.sliceProbes.get("SL-1")!.some((p) => /_AC-2\./.test(p)),
    "only the GRADING moved — the probe file stays with the parent, rides its commit, and survives for the maintainer",
  );
  assert.deepEqual(books.sliceVerifs.get("SL-1")!.map((v) => v.ac), [1, 3], "the other ordinals keep their names");

  const state = new RunState(() => {});
  const graded: Record<string, number[]> = {};
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      affected: async (p) => (p === "src/greet.mjs" ? "- greet.test.mjs [imports_from] src/greet.test.mjs:L1" : ""),
      worker: async (w) => {
        if (w.role === "test" && w.footprint[0]?.startsWith("probes/")) {
          for (const f of w.footprint)
            writeInto(
              w.worktree,
              f,
              // AC-3's probe reads the maintained home — the mis-homing that
              // slips through. Its failure message names NO path (SL-4's
              // shape): only the probe's source shows the read.
              /_AC-3\./.test(f)
                ? `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as fs from "node:fs";\n` +
                  `const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };\n` +
                  `test("brought under", () => assert.ok(/brought under/.test(read("src/greet.test.mjs")), "the pin lives in one of the gate-exempt test files"));\n`
                : /_AC-2\./.test(f)
                  ? `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as fs from "node:fs";\n` +
                    `test("header gone", () => assert.ok(!fs.readFileSync("src/greet.test.mjs", "utf8").includes("old header")));\n`
                  : GREEN_PROBE,
            );
          return { ok: true, finalText: "done" };
        }
        if (w.role === "test") {
          writeInto(w.worktree, "src/greet.test.mjs", "// brought under the new rule\n");
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        const reply = await w.verifyTool!();
        graded["coder"] = [...(reply.match(/AC-(\d+)/g) ?? [])].map((x) => Number(x.slice(3)));
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.ok(!graded["coder"].includes(2), "the coder was never graded on the maintainer's check");
  assert.ok(graded["coder"].includes(3), "the sneaky check did reach the coder's verify — the transfer is what saves it");
  assert.equal(state.units.get("SL-1#eu-0")?.state, "done", "the coder is green of its own — the pruned-home probe did not fail it");
  assert.equal(state.units.get("SL-1-tests#eu-0")?.state, "done", "the maintainer went green on the full set");
  assert.ok(
    outcome.delivery?.rulings?.some((r) => /graded at the maintainer of src\/greet\.test\.mjs/.test(r.reason)),
    "the transfer is on the delivery's record",
  );
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the run delivers");
});

test("the supervisor's WIDEN has power: a validated widening reaches the fence and the unit delivers; a test file or a pending unit's file is refused; a contained violation fails the unit without halting the run", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  // The file the check really needs, outside the promise's footprint.
  fs.writeFileSync(path.join(repo, "src", "deps.mjs"), `export const key = "";\n`);
  g(["add", "-A"]);
  g(["commit", "-qm", "base"]);
  let s = emptySpace();
  const a = addAsk(s, "each notice carries its own key", "t");
  if (!a.ok) throw new Error("ask");
  s = a.space;
  const n = addNode(s, {
    sentence: "notices carry the key",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the key is not empty" }],
    // The grounding missed src/deps.mjs — SL-10's gap.
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  if (!n.ok) throw new Error("node");
  s = n.space;
  const cut = { id: "cut-1", changeIds: [n.added.id], tepId: "TEP-t-73" };
  const slices = tepSlices({ space: s, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const answers: string[] = [];
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async (_d, prompt) =>
        prompt.includes("THE WORKER'S QUESTION")
          ? "WIDEN: src/deps.mjs probes/held.test.mjs src/greet.mjs — the check reads the key from deps"
          : null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(
            w.worktree,
            w.footprint[0],
            `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
              `import { key } from "../src/deps.mjs";\ntest("key", () => assert.ok(key.length > 0));\n`,
          );
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export {};\n`);
        const reply = await new Promise<string>((resolve) => w.onPark("AC-1 needs src/deps.mjs — widen my footprint?", resolve));
        answers.push(reply);
        assert.ok(w.footprint.includes("src/deps.mjs"), "the widening reached the unit's own footprint — the fence reads the same array");
        assert.ok(!w.footprint.includes("probes/held.test.mjs"), "a test path is never granted");
        writeInto(w.worktree, "src/deps.mjs", `export const key = "alpha";\n`);
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.match(answers[0], /footprint was widened/i);
  assert.match(answers[0], /Refused: probes\/held\.test\.mjs \(test-shaped/, "the refusal is said with its reason");
  assert.equal(state.units.get("SL-1#eu-0")?.state, "done", "the unit delivered inside its widened footprint");
  assert.ok(outcome.delivery && !outcome.delivery.withheld);
  assert.ok(outcome.delivery!.rulings?.some((r) => r.criterionId === "footprint" && /src\/deps\.mjs/.test(r.reason)), "the widening rides the delivery as a ruling");
});

test("a stray write is contained, the unit fails, and the run goes on — the other slices keep their own fate", async () => {
  const repo = tmpRepo();
  let s = emptySpace();
  const a1 = addAsk(s, "greet the user", "t");
  if (!a1.ok) throw new Error("ask");
  s = a1.space;
  const n1 = addNode(s, {
    sentence: "a greet module",
    serves: [a1.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  if (!n1.ok) throw new Error("node");
  s = n1.space;
  const n2 = addNode(s, {
    sentence: "a farewell module",
    serves: [a1.added.id],
    needs: [],
    acceptance: [{ id: "c2", text: "bye() returns 'bye'" }],
    grounding: { touchpoints: [{ path: "src/bye.mjs", planned: true }], stamp: [] },
  });
  if (!n2.ok) throw new Error("node2");
  s = n2.space;
  const cut = { id: "cut-1", changeIds: [n1.added.id, n2.added.id], tepId: "TEP-t-74" };
  const slices = tepSlices({ space: s, cut, spaceName: "greet space" });
  assert.ok(slices.length >= 2, "two slices");
  const state = new RunState(() => {});
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
          writeInto(w.worktree, w.footprint[0], w.footprint[0].includes("SL-1") ? GREEN_PROBE : GREEN_PROBE.replace(/greet/g, "bye").replace(/hello/g, "bye"));
          return { ok: true, finalText: "done" };
        }
        if (w.footprint.includes("src/greet.mjs")) {
          // The stray: writes a file it does not own.
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
          writeInto(w.worktree, "src/stray.mjs", "// not mine\n");
          return { ok: true, finalText: "done", containment: true } as never;
        }
        writeInto(w.worktree, "src/bye.mjs", `export function bye() { return "bye"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.equal(state.units.get("SL-1#eu-0")?.state, "failed", "the violator failed");
  assert.match(state.units.get("SL-1#eu-0")?.note ?? "", /reverted/);
  assert.equal(state.halted, false, "the run was not halted");
  assert.equal(state.units.get("SL-2#eu-0")?.state, "done", "the other slice kept its own fate");
});

test("a tester whose probes are all written completes on a doubt — the doubt rides the delivery; a CONTRACT answer becomes the coder's contract", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-75" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let coderBrief = "";
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async (_d, prompt) =>
        prompt.includes("THE WORKER'S LINE")
          ? "CONTRACT: the coder exports greet from src/greet.mjs so the check can import it directly."
          : null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return {
            ok: false,
            finalText:
              "All probes written.\nDECISION: greet() returns exactly 'hello'\n" +
              "UNDELIVERED: the probe reaches greet only through its module seam — question: should the coder export a direct seam?",
            undelivered: ["the probe reaches greet only through its module seam — question: should the coder export a direct seam?"],
          };
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
  assert.equal(state.units.get("SL-1#eu-1")?.state, "done", "the tester completed — all its probes exist");
  assert.match(coderBrief, /TESTER'S DECISIONS[\s\S]*greet\(\) returns exactly 'hello'/, "its decisions still flow");
  assert.match(coderBrief, /exports greet from src\/greet\.mjs/, "and the CONTRACT answer flows to the coder as contract");
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the run delivers");
});

test("a widening refused for a pending owner's file crosses the slice boundary: the obligation lands in the owner's brief, and the asker is told to keep callers compiling", async () => {
  const repo = tmpRepo();
  const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "deps.mjs"), `export const key = "";\n`);
  g(["add", "-A"]);
  g(["commit", "-qm", "base"]);
  let s = emptySpace();
  const a = addAsk(s, "notices carry their key, and the session threads it", "t");
  if (!a.ok) throw new Error("ask");
  s = a.space;
  const n1 = addNode(s, {
    sentence: "the deps carry the key",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the key is not empty" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  if (!n1.ok) throw new Error("n1");
  s = n1.space;
  const n2 = addNode(s, {
    sentence: "the session threads the key through",
    serves: [a.added.id],
    // The owner runs AFTER the asker, so the crossed contract is on the
    // record before its brief is built — the test asserts the flow, not a race.
    needs: [n1.added.id],
    acceptance: [{ id: "c2", text: "session() returns the key" }],
    grounding: { touchpoints: [{ path: "src/session.mjs", planned: true }], stamp: [] },
  });
  if (!n2.ok) throw new Error("n2");
  s = n2.space;
  const cut = { id: "cut-1", changeIds: [n1.added.id, n2.added.id], tepId: "TEP-t-76" };
  const slices = tepSlices({ space: s, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let askerReply = "";
  let ownerBrief = "";
  const gate = { askerDone: false };
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async (_d, prompt) =>
        prompt.includes("THE WORKER'S QUESTION")
          ? "WIDEN: src/session.mjs — the check needs the session to thread the key"
          : null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], w.footprint[0].includes("SL-1") ? GREEN_PROBE.replace(/greet/g, "key").replace(/hello/g, "k").replace("../src/key.mjs", "../src/greet.mjs") : GREEN_PROBE.replace(/greet/g, "session").replace(/hello/g, "k"));
          return { ok: true, finalText: "done" };
        }
        if (w.footprint.includes("src/greet.mjs")) {
          writeInto(w.worktree, "src/greet.mjs", `export function key() { return "k"; }\n`);
          askerReply = await new Promise<string>((resolve) => w.onPark("I need src/session.mjs — widen?", resolve));
          gate.askerDone = true;
          return { ok: true, finalText: "done" };
        }
        // The owner's coder. The guarantee is per ATTEMPT: a contract that
        // crossed after this launch arrives at the next attempt's brief. So
        // hold work until the asker was answered; a first attempt without
        // the contract stays incomplete and reworks with a fresh brief.
        assert.ok(gate.askerDone, "the asker ran first — its refusal crossed before this brief was built");
        ownerBrief = brief;
        writeInto(w.worktree, "src/session.mjs", `export function session() { return "k"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    s,
    cut,
    slices,
  );
  assert.match(askerReply, /Refused: src\/session\.mjs \(owned by SL-2#eu-0, still pending\)/);
  assert.match(askerReply, /flowed to SL-2#eu-0 as contract/);
  assert.match(askerReply, /keep every existing caller compiling/i, "the interim rule is said at the moment it matters");
  assert.equal(state.units.get("SL-1#eu-0")?.state, "done");
  assert.equal(state.units.get("SL-2#eu-0")?.state, "done");
  assert.match(ownerBrief, /CROSS-SLICE \(from SL-1#eu-0\): a change in src\/session\.mjs is needed/, "the obligation landed in the owner's own brief");
});
