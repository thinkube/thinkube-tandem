/**
 * The tool's own repairs reach the ledger.
 *
 * A run cannot catch a defect in the machinery that runs it, so hundreds
 * of repairs to the extension left no trace while the work it supervised
 * was fully instrumented — and the one population the methodology most
 * needs to watch was the one it could not see. A repair is a commit, so
 * the commit is where it is said.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defectsIn, harvestSelfDefects, harvestMarkPath, rowFor, selfDefectsSince } from "./selfDefects";

/** A fake git that answers with commits in the format the reader asks for. */
function gitOf(commits: { sha: string; at: string; subject: string; body: string }[], head = "HEAD9") {
  return (args: string[]): string => {
    if (args[0] === "rev-parse") return `${head}\n`;
    // A range narrows to whatever follows the named sha.
    const range = args.find((a) => a.includes(".."));
    const from = range?.split("..")[0];
    const i = from ? commits.findIndex((c) => c.sha === from) : -1;
    if (from && i < 0) throw new Error("unknown revision");
    return commits
      .slice(i + 1)
      .map((c) => `\x1e${c.sha}\x1f${c.at}\x1f${c.subject}\x1f${c.body}`)
      .join("");
  };
}

test("only a commit that says what was wrong records anything", () => {
  assert.deepEqual(defectsIn("a subject\n\nDefect: the pipeline was read in the wrong case\n"), [
    "the pipeline was read in the wrong case",
  ]);
  assert.deepEqual(defectsIn("a feature\n\nnothing to declare"), [], "silence records nothing");
  assert.deepEqual(defectsIn("x\n\nDefect: none"), [], "and so does saying there was none");
  assert.deepEqual(defectsIn("x\n\ndefect:  two  \nDefect: three"), ["two", "three"], "two repairs, two rows");
});

test("a repair becomes a row typed as the machine's own", () => {
  const row = rowFor({ sha: "abc123", at: "2026-09-08T10:00:00Z", subject: "Fix the reader", said: "it read a pass as a failure" }, "2.0.330");
  assert.equal(row.type, "machine", "the tool, not the work it supervises");
  assert.equal(row.trigger, "self-repair");
  assert.equal(row.ts, "2026-09-08T10:00:00Z", "dated when the repair was made");
  assert.deepEqual(row.refs, ["abc123"], "and it names the commit, so it can be read back");
  assert.match(row.detail, /it read a pass as a failure/);
});

test("every repair is harvested once, and the next deploy starts where it stopped", () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-self-"));
  const commits = [
    { sha: "c1", at: "2026-09-01T00:00:00Z", subject: "one", body: "one\n\nDefect: the first thing was wrong\n" },
    { sha: "c2", at: "2026-09-02T00:00:00Z", subject: "two", body: "two\n\nno declaration\n" },
  ];
  const first = harvestSelfDefects({ repoRoot: "/nowhere", storeDir: store, git: gitOf(commits, "c2") });
  assert.equal(first.recorded, 1, "one commit spoke, one row");
  assert.equal(fs.readFileSync(harvestMarkPath(store), "utf8").trim(), "c2", "and it remembers where it got to");

  const again = harvestSelfDefects({ repoRoot: "/nowhere", storeDir: store, git: gitOf(commits, "c2") });
  assert.equal(again.recorded, 0, "harvesting again records nothing twice");

  commits.push({ sha: "c3", at: "2026-09-03T00:00:00Z", subject: "three", body: "three\n\nDefect: a later thing was wrong\n" });
  const third = harvestSelfDefects({ repoRoot: "/nowhere", storeDir: store, git: gitOf(commits, "c3") });
  assert.equal(third.recorded, 1, "only what is new");

  const written = fs
    .readFileSync(path.join(store, "defects", "2026-09.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(written.map((r) => r.refs[0]), ["c1", "c3"]);
  assert.ok(written.every((r) => r.type === "machine" && r.activity === "tool development"));
});

test("a mark git no longer knows reads the whole history rather than failing", () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-self-rebase-"));
  fs.mkdirSync(path.dirname(harvestMarkPath(store)), { recursive: true });
  fs.writeFileSync(harvestMarkPath(store), "gone-after-a-rebase\n");
  const commits = [{ sha: "c1", at: "2026-09-01T00:00:00Z", subject: "one", body: "one\n\nDefect: something\n" }];
  const r = harvestSelfDefects({ repoRoot: "/nowhere", storeDir: store, git: gitOf(commits, "c1") });
  assert.equal(r.recorded, 1, "a rebase does not silence the ledger");
});

test("a repository that cannot be read records nothing and does not throw", () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-self-none-"));
  const angry = (): string => {
    throw new Error("not a git repository");
  };
  assert.deepEqual(selfDefectsSince("/nowhere", undefined, angry), []);
  assert.equal(harvestSelfDefects({ repoRoot: "/nowhere", storeDir: store, git: angry }).recorded, 0);
});
