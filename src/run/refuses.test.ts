/**
 * What the machine refuses before anyone is graded.
 *
 * Every fault here cost a whole run in the field, and every one of them is
 * decidable the moment a check is written — before a coder starts, while
 * the cheapest thing to change is one file nobody has built against yet.
 *
 * These are properties, not incidents: each states a kind of check that can
 * never be evidence, and each is driven by the smallest check of that kind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditProbe } from "./probeAudit";
import { refusalsBeforeDispatch, skeletonFirst } from "./refusals";
import { emptySpace } from "../core/schema";

/** A repository with one directory, so the import audit has ground truth. */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-audit-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "greet.mjs"), "export const greet = () => 'hello';\n");
  return dir;
}

const PLANNED = ["src/greet.mjs"];

test("a check that reads the source instead of driving it is refused", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { readFileSync } from "node:fs";\n` +
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { greet } from "./greet.mjs";\n` +
      `test("greet exists", () => assert.match(readFileSync("src/greet.mjs", "utf8"), /hello/));\n`,
    repo(),
    PLANNED,
  );
  assert.equal(faults.filter((f) => f.kind === "source-text").length, 1, JSON.stringify(faults));
  assert.match(faults[0].detail, /Drive the behaviour instead/);
});

test("a check that imports nothing this cut builds is refused", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `test("two is two", () => assert.equal(2, 2));\n`,
    repo(),
    PLANNED,
  );
  assert.equal(faults.filter((f) => f.kind === "drives-nothing").length, 1, JSON.stringify(faults));
});

test("a check that simulates a platform the repository does not own is refused", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import Module from "node:module";\nModule._load = () => ({ greet: () => "hello" });\n` +
      `import { greet } from "./greet.mjs";\nimport { test } from "node:test";\ntest("greet", () => greet());\n`,
    repo(),
    PLANNED,
  );
  assert.equal(faults.filter((f) => f.kind === "simulator").length, 1, JSON.stringify(faults));
});

test("a check that drives what the cut builds passes every refusal", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { greet } from "./greet.mjs";\ntest("greet", () => assert.equal(greet(), "hello"));\n`,
    repo(),
    PLANNED,
  );
  assert.deepEqual(faults, [], "an honest check is refused nothing");
});

test("a check reading a fixture is not a source-text check", () => {
  // The rule must not refuse the ordinary: reading data a test owns is how
  // half the world's tests are written.
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { readFileSync } from "node:fs";\n` +
      `import { greet } from "./greet.mjs";\nimport { test } from "node:test";\n` +
      `test("greet", () => greet(readFileSync("fixtures/names.txt", "utf8")));\n`,
    repo(),
    PLANNED,
  );
  assert.deepEqual(
    faults.filter((f) => f.kind === "source-text"),
    [],
    "reading a fixture is not reading the source",
  );
});

/**
 * And what the machine refuses before it dispatches anybody — read from the
 * plan, said in the person's own words, with no worker started.
 */
test("a promise landing in two repositories is refused before any worker", () => {
  const refusals = refusalsBeforeDispatch({
    slices: [
      {
        handle: "SL-1",
        status: "ready",
        files: ["src/greet.mjs"],
        workUnits: [{ footprint: ["src/greet.mjs"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      } as never,
    ],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "greet the user everywhere",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "greet() returns hello" }],
          grounding: {
            touchpoints: [
              { path: "src/greet.mjs", planned: true, scope: "web" },
              { path: "src/greet.mjs", planned: true, scope: "api" },
            ],
            stamp: [],
          },
        },
      ],
    },
  });
  assert.equal(refusals.length, 1, JSON.stringify(refusals));
  assert.match(refusals[0], /more than one repository/);
  assert.match(refusals[0], /greet the user everywhere/, "the person's own words, not a file");
});

test("a promise whose only site its unit may not change is refused before any worker", () => {
  const refusals = refusalsBeforeDispatch({
    slices: [
      {
        handle: "SL-7",
        status: "ready",
        files: ["src/panel.mjs"],
        workUnits: [{ footprint: ["src/panel.mjs"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      } as never,
    ],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "one editor tab per thinking space",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "opening a space twice reveals the same tab" }],
          grounding: { touchpoints: [{ path: "src/extension.mjs", planned: false }], stamp: [] },
        },
      ],
    },
  });
  assert.equal(refusals.length, 1, JSON.stringify(refusals));
  assert.match(refusals[0], /may not change src\/extension\.mjs/);
});

test("a promise its unit can reach, in one repository, is refused nothing", () => {
  const refusals = refusalsBeforeDispatch({
    slices: [
      {
        handle: "SL-1",
        status: "ready",
        files: ["src/greet.mjs"],
        workUnits: [{ footprint: ["src/greet.mjs"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      } as never,
    ],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "greet the user",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "greet() returns hello" }],
          grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
        },
      ],
    },
  });
  assert.deepEqual(refusals, []);
});

test("the plan runs a thin end-to-end path first", () => {
  const slice = (handle: string, file: string): never =>
    ({ handle, status: "ready", files: [file], workUnits: [{ footprint: [file], execution: "serial", role: "code" }] }) as never;
  const ordered = skeletonFirst([slice("SL-1", "src/deep/core.mjs"), slice("SL-2", "src/main.mjs")], ["src/main.mjs"]);
  assert.deepEqual(
    ordered.map((s) => s.handle),
    ["SL-2", "SL-1"],
    "the slice that reaches the product's outer seam goes first",
  );
});
