/**
 * What the machine refuses when the plan's own parts collide.
 *
 * A slice is proven against what is committed plus its own files, and a
 * unit may write only inside its footprint. Both rules are load-bearing,
 * and both have a consequence the plan has to respect: two slices that
 * change what the other calls can never see each other, and two slices
 * driving one module must not be handed the same address for a check.
 *
 * Every case here was found the expensive way — a worker grinding rounds
 * against a state no edit of its own could reach — and every one of them
 * was decidable from the plan before anybody started.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refusedBeforeDispatch } from "./refusals";
import { rehouseChecks } from "./checkHomes";
import { outsideFootprint } from "./answers";
import { clearanceLesson } from "./worker";
import { emptySpace } from "../core/schema";

test("two slices driving one module never mint the same check", () => {
  // A tester found another unit's finished checks at its own addresses,
  // asked what to do, was told in prose to use later numbers, and the
  // guard reverted the first file it wrote there — because prose does not
  // move a footprint. The ordinal counts within a slice; two slices on one
  // module both start at one, and beside that module that is one name.
  const slice = (handle: string, n: number) => ({
    handle,
    workUnits: [
      { role: "code", footprint: ["src/surfaces/panels.ts"] },
      {
        role: "test",
        footprint: Array.from({ length: n }, (_, i) => `probes/x__${handle}_AC-${i + 1}.test.mjs`),
      },
    ],
  });
  const slices = [slice("SL-6", 6), slice("SL-7", 7)];
  rehouseChecks(slices as never, ["src/surfaces/panels.ts", "src/surfaces/panels.test.ts"]);
  const homes = slices.flatMap((s) => (s.workUnits[1] as { footprint: string[] }).footprint);
  assert.equal(new Set(homes).size, homes.length, `two slices took the same address: ${homes.join(" ")}`);
  assert.equal(homes.length, 13);
});

test("a check is never minted onto a file the repository already has", () => {
  const slices = [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: ["src/greet.mjs"] },
        { role: "test", footprint: ["probes/x__SL-1_AC-1.test.mjs"] },
      ],
    },
  ];
  rehouseChecks(slices as never, ["src/greet.mjs", "src/greet.test.mjs", "src/greet_AC-1.test.mjs"]);
  assert.deepEqual(
    (slices[0].workUnits[1] as { footprint: string[] }).footprint,
    ["src/greet_AC-2.test.mjs"],
    "the address the repository already holds is not overwritten",
  );
});

test("two slices that change what the other calls are refused before any worker", async () => {
  // SL-5 changed a constructor it owned; its only call site was in another
  // unit's hands. Each is proven against what is committed plus its own
  // files, so SL-5's runner held the new constructor and the old call and
  // could not compile. It ground twenty rounds against a state no edit
  // inside its clearance could reach, and reported a broken verifier.
  const graph = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-map-")), "graph.json");
  fs.writeFileSync(
    graph,
    JSON.stringify({
      nodes: [
        { id: "ext", source_file: "src/extension.ts" },
        { id: "panel", source_file: "src/surfaces/panel.ts" },
      ],
      links: [{ relation: "imports", source: "ext", target: "panel", source_file: "src/extension.ts" }],
    }),
  );
  const slice = (handle: string, file: string, criterion: string) => ({
    handle,
    status: "ready",
    files: [file],
    workUnits: [{ footprint: [file], execution: "serial", role: "code" }],
    criterionIds: [criterion],
  });
  const r = await refusedBeforeDispatch({
    slices: [slice("SL-5", "src/surfaces/panel.ts", "c1"), slice("SL-7", "src/extension.ts", "c2")] as never,
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "a space's tab carries its own name",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "the tab shows the space's name" }],
          grounding: { touchpoints: [{ path: "src/surfaces/panel.ts", planned: true }], stamp: [] },
        },
        {
          id: "n2",
          sentence: "opening a space twice reveals the same tab",
          serves: [],
          needs: [],
          acceptance: [{ id: "c2", text: "opening twice reveals one tab" }],
          grounding: { touchpoints: [{ path: "src/extension.ts", planned: true }], stamp: [] },
        },
      ],
    } as never,
    cut: { id: "cut-1", changeIds: ["n1", "n2"] } as never,
    repoRoot: "/nowhere",
    graphPath: graph,
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  assert.ok(r.refusal, "the pair is refused");
  assert.match(r.refusal!.refusal, /SL-5 and SL-7/);
  assert.match(r.refusal!.refusal, /src\/extension\.ts uses src\/surfaces\/panel\.ts/);
  assert.match(r.refusal!.refusal, /one piece of work, or one after the other/);
});

test("two slices joined by use are allowed when one waits for the other", async () => {
  const graph = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-map-")), "graph.json");
  fs.writeFileSync(
    graph,
    JSON.stringify({
      nodes: [
        { id: "ext", source_file: "src/extension.ts" },
        { id: "panel", source_file: "src/surfaces/panel.ts" },
      ],
      links: [{ relation: "imports", source: "ext", target: "panel", source_file: "src/extension.ts" }],
    }),
  );
  const r = await refusedBeforeDispatch({
    slices: [
      {
        handle: "SL-5",
        status: "ready",
        files: ["src/surfaces/panel.ts"],
        workUnits: [{ footprint: ["src/surfaces/panel.ts"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      },
      {
        handle: "SL-7",
        status: "ready",
        files: ["src/extension.ts"],
        // It waits for what the other produces, so the earlier work is
        // committed before this one is ever verified.
        workUnits: [
          {
            footprint: ["src/extension.ts"],
            execution: "serial",
            role: "code",
            consumes: ["src/surfaces/panel.ts"],
          },
        ],
        criterionIds: ["c2"],
      },
    ] as never,
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "a space's tab carries its own name",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "the tab shows the space's name" }],
          grounding: { touchpoints: [{ path: "src/surfaces/panel.ts", planned: true }], stamp: [] },
        },
        {
          id: "n2",
          sentence: "opening a space twice reveals the same tab",
          serves: [],
          needs: [],
          acceptance: [{ id: "c2", text: "opening twice reveals one tab" }],
          grounding: { touchpoints: [{ path: "src/extension.ts", planned: true }], stamp: [] },
        },
      ],
    } as never,
    cut: { id: "cut-1", changeIds: ["n1", "n2"] } as never,
    repoRoot: "/nowhere",
    graphPath: graph,
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  assert.equal(r.refusal, undefined, JSON.stringify(r.refusal));
});

test("an answer that names files a unit may not write is not passed on", () => {
  // The supervisor renumbered a tester's checks in prose — "your real
  // footprint is AC-7 through AC-13". Prose does not move a footprint. The
  // worker did as it was told, the guard restored the first file it wrote
  // there, and the unit failed for obeying.
  const mine = ["src/surfaces/panels_AC-1.test.ts", "src/surfaces/panels_AC-7.test.ts"];
  assert.deepEqual(
    outsideFootprint("your real footprint is src/surfaces/panels_AC-8.test.ts through panels_AC-13.test.ts", mine),
    ["src/surfaces/panels_AC-8.test.ts"],
  );
  assert.deepEqual(
    outsideFootprint("write your assertions in src/surfaces/panels_AC-7.test.ts", mine),
    [],
    "a path the unit owns is not stray",
  );
  assert.deepEqual(
    outsideFootprint("the constructor now takes four arguments; assert on the title it was built with", mine),
    [],
    "an answer that names no file is left alone",
  );
});

test("the first write outside a clearance teaches; it does not end the unit", () => {
  // A coder found that its own criterion needed one additive line in a
  // table no slice owned. It knew the rule, quoted the half that says the
  // run clears you and you make the change yourself, dropped the half that
  // says ask first, and edited the file. The guard restored it and killed
  // the unit — discarding an hour of correct work for a line the run would
  // have granted.
  const said = clearanceLesson(["src/surfaces/phase.ts"], ["src/gates/render.ts", "src/surfaces/inbound.ts"]);
  assert.match(said, /src\/surfaces\/phase\.ts was restored/);
  assert.match(said, /not a refusal/, "the change is reachable — only the order was wrong");
  assert.match(said, /Say which file you need and which criterion requires it/);
  assert.match(said, /src\/gates\/render\.ts, src\/surfaces\/inbound\.ts/, "it says what may be written");
  assert.match(said, /again and the unit ends here/, "and that a second time is final");
});
