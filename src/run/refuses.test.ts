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
