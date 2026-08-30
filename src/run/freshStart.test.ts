/**
 * Starting a cut from nothing, without losing what is thrown away.
 *
 * A rerun resumes: a slice an earlier run committed stands, and only what
 * never finished runs again. That is right when the last run merely
 * stopped, and wrong when the run's own machinery changed underneath it —
 * then the finished units were judged by rules that have since been
 * corrected, and a resume proves almost nothing. Asking for the whole cut
 * again used to mean deleting the branch by hand.
 *
 * The branch is where the resume lives, so it goes — and its head is
 * tagged first, because an hour of work discarded by one gesture must
 * still be reachable by name afterwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { discardRunBranch, discardTag } from "./freshStart";

/** git, as a script of what each command answers and a record of the calls. */
function git(answers: Record<string, { code?: number; out?: string }> = {}) {
  const ran: string[][] = [];
  const exec = async (_cmd: string, args: string[]) => {
    ran.push(args);
    const key = args.find((a) => ["rev-parse", "tag", "worktree", "branch", "push", "prune"].includes(a)) ?? "";
    const a = answers[key] ?? {};
    return { code: a.code ?? 0, out: a.out ?? "" };
  };
  return { ran, exec, did: (verb: string) => ran.some((r) => r.includes(verb)) };
}

const AT = new Date("2026-08-30T10:11:49Z");

test("the discarded head is tagged before the branch is removed", async () => {
  const g = git({ "rev-parse": { out: "9303af2f00\n" } });
  const r = await discardRunBranch({
    repoRoot: "/repo",
    branch: "tandem/proj/TEP-1",
    worktree: "/wt/proj__TEP-1",
    exec: g.exec as never,
    now: () => AT,
    log: () => {},
  });

  assert.equal(r.discarded?.head, "9303af2f00");
  assert.equal(r.discarded?.tag, "discarded/proj/TEP-1-20260830T101149Z");

  const order = g.ran.map((a) => a.find((x) => ["tag", "worktree", "branch", "push"].includes(x))).filter(Boolean);
  assert.deepEqual(
    order,
    ["tag", "worktree", "worktree", "branch", "push"],
    "tagged first, then the worktree that holds it, then the branch here, then the forge's copy",
  );
});

test("a cut that never ran here is left alone, and says so", async () => {
  const g = git({ "rev-parse": { out: "" } });
  const r = await discardRunBranch({
    repoRoot: "/repo",
    branch: "tandem/proj/TEP-9",
    worktree: "/wt/proj__TEP-9",
    exec: g.exec as never,
    now: () => AT,
    log: () => {},
  });

  assert.match(r.nothing ?? "", /has not run here before/);
  assert.equal(g.did("tag"), false, "nothing is tagged");
  assert.equal(g.did("branch"), false, "and nothing is deleted");
});

test("a branch that will not delete leaves the tag standing and refuses quietly", async () => {
  const g = git({ "rev-parse": { out: "abc123\n" }, branch: { code: 1, out: "error: worktree is dirty" } });
  const r = await discardRunBranch({
    repoRoot: "/repo",
    branch: "tandem/proj/TEP-1",
    worktree: "/wt/proj__TEP-1",
    exec: g.exec as never,
    now: () => AT,
    log: () => {},
  });

  assert.equal(r.discarded, undefined, "nothing is claimed as discarded when the branch still stands");
  assert.match(r.nothing ?? "", /could not be removed: error: worktree is dirty/);
  assert.equal(g.did("push"), false, "and the forge's copy is not touched either");
});

test("the tag names the branch and the moment, so two discards never collide", () => {
  const a = discardTag("tandem/proj/TEP-1", new Date("2026-08-30T10:11:49Z"));
  const b = discardTag("tandem/proj/TEP-1", new Date("2026-08-30T18:02:00Z"));
  assert.notEqual(a, b);
  assert.match(a, /^discarded\/proj\/TEP-1-2026/);
});
