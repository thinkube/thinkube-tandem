/**
 * Two rules about the shape of this repository itself: nothing grows past
 * reading size, and nothing is kept that nothing reaches.
 *
 * The size limit exists because files here once reached five
 * thousand lines.
 *
 * It briefly withheld a delivery of unrelated work, and my answer was to
 * delete it — which would have let the files grow back. The rule was never
 * the problem: the files were. They are split now, so it holds again, and
 * the next fix is to refuse the write that breaks it rather than to
 * discover it at the gate, when the only actor left is a closer under
 * pressure with the whole tree in front of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { gatedActions } from "./surfaces/phase";
import { renderedTable } from "./surfaces/railHarness.test";

const repo = path.resolve(__dirname, "..");
const harnessBundle = path.join(repo, "out-test", "harness", "buttons.cjs");
const SIZE_LIMIT = 600;

test(`module size: no file exceeds ${SIZE_LIMIT} lines (the imported engine is exempt)`, () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (["node_modules", "out", "out-test", "media", "engine"].includes(name)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const lines = fs.readFileSync(p, "utf8").split("\n").length;
        if (lines > SIZE_LIMIT) offenders.push(`${path.relative(repo, p)}: ${lines}`);
      }
    }
  };
  walk(path.join(repo, "src"));
  walk(path.join(repo, "webview", "map", "src"));
  assert.deepEqual(offenders, []);
});

test("nothing in this repository is unreachable from the product's own entry points", () => {
  // The gate was off because its old configuration used TEST files as entry
  // points, which made it a coverage gate wearing a reachability gate's
  // name: anything a test imported counted as reached. With the product's
  // real entry point it says something true — and the day it went back on it
  // found four files and sixty-two exports that nothing reached, all of them
  // kept alive by tests that no longer exist.
  // A finding is a non-zero exit, which execFileSync throws on: the finding
  // itself is on the error's stdout, and a reader needs to see it rather
  // than the words "command failed".
  let out = "";
  try {
    out = execFileSync("npx", ["knip", "--no-progress"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    out = String((err as { stdout?: string }).stdout ?? err).trim();
  }
  assert.equal(out, "", `unreachable code:\n${out}`);
});

// A control's action lives in two places that must agree: the surface's
// own list of what is shaping, and the phase table that says when the host
// acts on it. They fail in opposite directions and neither speaks — an
// action absent from the table is refused in NO phase and enabled in none
// either, so the host always acts on it and its button is dead forever. A
// unit that built a new control found this from the inside, could not fix
// it (the table is not its to write), edited it anyway, and the guard
// ended it.
//
// The surface's half is read from the RUNNING module by way of the harness
// bundle, never with a regex over vscode.ts source text: recovered as text
// the comparison is as green for a stub that spells the same names as for
// the real list.

test("the phase table is reachable and non-empty", () => {
  // The size and reachability rules above are this file's own subject.
  // This one guards the premise the set-equality below rests on: a table
  // that went empty would make that comparison hold vacuously.
  assert.notDeepEqual(gatedActions(), [], "no action is governed by any phase");
});

/**
 * INVARIANT: every check source in this repository has a compiled
 * counterpart under `out-test/`.
 *
 * The toolchain is `tsc -p tsconfig.test.json && node --test out-test/`, so
 * a check is executed through its BUILT file, never its source. `out-test/`
 * is gitignored: a checkout that has not run the build has none of them.
 * `node --test` given a path that matches no file exits 0 with nothing run,
 * so a check invoked that way reports green while never executing a line of
 * the code it drives — green for a stub as readily as for the real thing.
 *
 * That is the hole `src/engine/verificationRunnable.ts` names for an
 * unregistered source; an unbuilt tree is the same hole reached by the other
 * road, and registration cannot see it. Asserted here so the absence of the
 * build is a named failure with the missing files in it, rather than a
 * silent pass nobody can tell from a real one.
 */
test("every check source has a compiled counterpart, so none can report green without running", () => {
  const outTest = path.join(repo, "out-test");
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (["node_modules", "out", "out-test", "media"].includes(name)) continue;
        walk(p);
      } else if (/\.test\.ts$/.test(name)) {
        sources.push(path.relative(path.join(repo, "src"), p));
      }
    }
  };
  walk(path.join(repo, "src"));
  assert.notDeepEqual(sources, [], "no check sources were found at all");

  const unbuilt = sources.filter(
    (s) => !fs.existsSync(path.join(outTest, s.replace(/\.ts$/, ".js"))),
  );
  assert.deepEqual(
    unbuilt,
    [],
    `these checks have no compiled counterpart, so running them executes nothing and ` +
      `reports green regardless of what the code does — the test build has not been run ` +
      `over this tree (npx tsc -p tsconfig.test.json):\n${unbuilt.join("\n")}`,
  );
});

// INVARIANT: the two lists are set-equal. Stated in both directions so a
// failure says WHICH side is missing the name, not merely that they differ.
test("every action the surface can send is governed by a phase, and every governed action can be sent", () => {
  const table = JSON.parse(renderedTable(repo, harnessBundle)) as Record<string, unknown>;
  const list = table["shaping:actions"];
  assert.ok(Array.isArray(list), "the surface no longer reports which actions are shaping");
  const shaping = [...(list as string[])].sort();
  const gated = [...gatedActions()].sort();
  assert.deepEqual(
    shaping.filter((a) => !gated.includes(a)),
    [],
    "the surface can send these, and no phase governs them",
  );
  assert.deepEqual(
    gated.filter((a) => !shaping.includes(a)),
    [],
    "the phase table governs these, and the surface never sends them",
  );
  // The set-equality above holds vacuously if waive-docs is missing from
  // each side, so the gesture this work adds is named on both.
  assert.ok(shaping.includes("waive-docs"), "the surface cannot send waive-docs");
  assert.ok(gated.includes("waive-docs"), "no phase governs waive-docs");
});
