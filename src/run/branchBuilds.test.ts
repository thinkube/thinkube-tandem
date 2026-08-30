/**
 * Whoever stops the branch building is named where they land.
 *
 * A unit is graded in an isolated runner — the committed branch plus that
 * unit's own files — where `prepare` runs: enough to make the checks
 * runnable, and in this repository not enough to bundle the webview. What
 * SHIPS ran only at the closing gate, hours later.
 *
 * So one unit rewrote a re-export and dropped a name another file
 * imported. It compiled, passed every check, and landed. Thirty-four
 * minutes later the next unit inherited a branch that would not build and
 * spent eighty-two minutes before ending undelivered — for one word in a
 * file it was not cleared to write, put there by a unit already finished
 * and gone.
 *
 * Neither of the obvious places can answer it. The shared worktree cannot:
 * every unit writes there at once, so half of any build is somebody's
 * unfinished sentence. The error's filename cannot either: this break was
 * made in the breaker's OWN file and surfaced in a file belonging to
 * nobody in the run. What answers it is the branch's own history — green
 * before, red after, and the slice in between is the one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { watchBranchBuild } from "./branchBuilds";

/** The branch, as a sequence of build verdicts one per landing. */
function landing(verdicts: Record<string, number>) {
  const said: string[] = [];
  const faults: { slice?: string; trigger: string }[] = [];
  let now = "";
  const w = watchBranchBuild({
    repoRoot: "/repo",
    branch: "tandem/TEP-1",
    wtRoot: "/wt",
    tep: "TEP-1",
    build: "npm run compile",
    exec: (async () => ({ code: 0, out: "" })) as never,
    snapshot: async () => ({ ok: true as const }),
    run: async () => ({
      code: verdicts[now] ?? 0,
      output: verdicts[now] ? "src/Implications.tsx(3,28): error TS2305: './vscode' has no exported member 'whyNot'." : "",
    }),
    log: (l) => said.push(l),
    defect: (e) => faults.push({ ...(e.slice ? { slice: e.slice } : {}), trigger: e.trigger }),
  });
  return { w, said, faults, land: async (slice: string) => ((now = slice), w.after(slice)) };
}

test("the slice that lands between green and red is the one named", async () => {
  const { w, said, faults, land } = landing({ "SL-9": 2, "SL-18": 2 });

  await land("SL-1"); // green: the control
  await land("SL-9"); // the re-export loses a name
  await land("SL-18"); // still red, but not its doing

  assert.equal(w.broken()?.slice, "SL-9");
  assert.equal(
    said.filter((l) => l.includes("no longer builds")).length,
    1,
    "said once, when it breaks — not again for every unit that inherits it",
  );
  assert.match(said.join("\n"), /SL-9 landed and the product no longer builds/);
  assert.match(said.join("\n"), /this is its break, not the next unit's/);
  assert.deepEqual(faults, [{ slice: "SL-9", trigger: "broke-the-build" }], "one fault, on the slice that caused it");
});

test("a branch already broken when the run starts is charged to nobody", async () => {
  const { said, faults, land } = landing({ "SL-1": 2 });
  await land("SL-1");
  assert.match(said.join("\n"), /did not build before this run's work landed — SL-1 is not the cause/);
  assert.deepEqual(faults, [{ trigger: "inherited" }], "no slice is named for what the run walked into");
});

test("a break that a later slice repairs is said to be over", async () => {
  const { w, said, land } = landing({ "SL-9": 2 });
  await land("SL-1");
  await land("SL-9");
  await land("SL-20");
  assert.equal(w.broken(), undefined, "the branch builds again");
  assert.match(said.join("\n"), /builds again, after SL-20 landed/);
});

test("a repository whose product build is its prepare has nothing extra to do", async () => {
  let built = 0;
  const w = watchBranchBuild({
    repoRoot: "/repo",
    branch: "b",
    wtRoot: "/wt",
    tep: "TEP-1",
    exec: (async () => ({ code: 0, out: "" })) as never,
    snapshot: async () => ({ ok: true as const }),
    run: async () => ((built += 1), { code: 0, output: "" }),
    log: () => {},
    defect: () => {},
  });
  await w.after("SL-1");
  assert.equal(built, 0, "the runner's own prepare already covers it — nothing is built twice");
});
