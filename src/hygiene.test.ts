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
import { gatedActions, refusedNow } from "./surfaces/phase";
import { can, noteAllowed, refusalIfRefused, refusalSentence, SHAPING, CONTROL_NAMES } from "./surfaces/surfaceContract";
import { AFFORDANCES } from "./surfaces/affordances";

const repo = path.resolve(__dirname, "..");

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

test("every shaping action the surface can send is gated by a phase", () => {
  // A control's action lives in two places that must agree: the surface's
  // own list of what is shaping, and the phase table that says when the
  // host acts on it. They fail in opposite directions and neither speaks —
  // an action absent from the table is refused in NO phase and enabled in
  // none either, so the host always acts on it and its button is dead
  // forever. A unit that built a new control found this from the inside,
  // could not fix it (the table is not its to write), edited it anyway,
  // and the guard ended it.
  //
  // The set is imported, not read as text: what must agree with the phase
  // table is the set the surface actually consults, not a spelling in a
  // file that a regex happens to match.
  const shaping = [...SHAPING].sort();
  const gated = gatedActions().sort();
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
});

test("the surface's own gate refuses a shaping action the host does not allow now", () => {
  // The set only matters because can() reads it. Drive the real function:
  // a shaping action outside the allowed list is off, the same action
  // inside it is on, and a non-shaping action is always on.
  noteAllowed(["build"]);
  assert.equal(can("build"), true, "an allowed shaping action is on");
  assert.equal(can("exempt-docs"), false, "a shaping action the host does not allow now is off");
  assert.equal(can("read-log"), true, "a non-shaping action is never gated");

  // Before the first push nothing is known, so nothing is refused here —
  // the host still refuses on its side.
  noteAllowed(undefined);
  assert.equal(can("exempt-docs"), true, "with no push yet the surface refuses nothing");
});

test("every action the phase table governs has a person-facing control name", () => {
  // gatedActions() is the set the host actually consults — imported, not
  // matched as text — and CONTROL_NAMES must cover every one of them, or
  // refusalSentence falls back to a bare action id for a control nobody named.
  const unnamed = gatedActions().filter((a) => !CONTROL_NAMES[a]);
  assert.deepEqual(unnamed, [], `these gated actions have no control name: ${unnamed.join(", ")}`);
});

test("the allowed-list recorder carries the phase so a refused control names both", () => {
  // Every caller of noteAllowed must hand it the phase the same push
  // carried, or refusalIfRefused renders the bare fallback with no phase
  // reason in it — the hygiene drive proves the recorder itself does this.
  noteAllowed(["read-draft"], "running");
  const sentence = refusalIfRefused("build");
  assert.equal(
    sentence,
    refusalSentence("build", "running"),
    "the sentence a person reads names the control and the phase's own reason",
  );
  assert.ok(sentence?.includes(CONTROL_NAMES["build"]), "the control's person-facing name is in the sentence");
  assert.equal(refusalIfRefused("read-draft"), undefined, "an allowed action is not refused");
  noteAllowed(undefined);
});

test("the host's refusal says exactly the sentence the surface would give for the same action and phase", () => {
  // refusedNow and refusalSentence must never drift into two wordings for
  // one press — a control refused by the host reads the same as a control
  // the surface itself disabled.
  for (const action of gatedActions()) {
    for (const phase of ["running", "understood", "signed", "delivered", "read", "drafting"] as const) {
      const hostSaid = refusedNow(action, phase);
      if (hostSaid === undefined) continue;
      assert.equal(
        hostSaid,
        refusalSentence(action, phase),
        `${action} in phase ${phase}: host and surface disagree`,
      );
    }
  }
});

test("every human door names its own control inside its own instruction", () => {
  // CONTROL_NAMES is the one place a control's person-facing name lives;
  // the affordance registry's gesture text is a separate hand-written
  // sentence for the same action. Nothing ties them together at compile
  // time, so a control renamed in one place silently drifts from the
  // other — a refusal calls it one thing while the instruction that
  // teaches a person to press it calls it another. Both sets are driven
  // here, never scraped from a file as text.
  const mismatches: string[] = [];
  for (const [action, entry] of Object.entries(AFFORDANCES)) {
    if (entry.kind !== "human") continue;
    const name = CONTROL_NAMES[action];
    if (!name) {
      mismatches.push(`${action}: no entry in CONTROL_NAMES`);
      continue;
    }
    if (!entry.affordance.gesture.includes(name)) {
      mismatches.push(`${action}: gesture "${entry.affordance.gesture}" does not contain "${name}"`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join("\n"));
});

/**
 * The one hole in the brand, watched.
 *
 * `Proved` makes an invented command about the target repository a compile
 * error — a plain string is not assignable, so the compiler enumerates
 * every one of them, including the ones nobody has written yet. A cast is
 * the only way past it, so the cast is the thing to check, and there is
 * exactly one legitimate site: where a command has just been run and
 * answered.
 */
test("only the minting site casts to Proved", () => {
  const casts: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (["node_modules", "out", "out-test", "media", "engine"].includes(name)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const rel = path.relative(repo, p);
        if (rel === "src/run/proved.ts") continue;
        for (const [i, line] of fs.readFileSync(p, "utf8").split("\n").entries())
          if (/\bas\s+(unknown\s+as\s+)?Proved\b/.test(line) && !line.trimStart().startsWith("*"))
            casts.push(`${rel}:${i + 1}`);
      }
    }
  };
  walk(path.join(repo, "src"));
  assert.deepEqual(
    casts,
    [],
    "a command about the target repository was asserted rather than run — mint it with proved() at the site that ran it",
  );
});
