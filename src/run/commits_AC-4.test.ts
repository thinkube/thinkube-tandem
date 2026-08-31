/**
 * TRANSITION — makeCommitBook now takes this run's own runId and must ride
 * it onto every slice commit it makes, as a trailer in the commit message
 * body: the subject stays exactly `tandem: <tep> <slice>` (a later resume
 * still parses it), and the body is where the run that did the work is
 * named, so a later run can tell a reader which run to credit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCommitBook } from "./commits";
import { RunState } from "./state";

test("finishUnit's slice commit carries the exact subject and the run id as a trailer", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const exec = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { code: 0, out: "" };
  };
  const st = new RunState(() => {});
  const dag = [{ id: "SL-1#eu-0", slice: "SL-1", footprint: ["src/greet.ts"] }];
  const done = new Set<string>();
  const failed = new Set<string>();
  const undelivered: string[] = [];

  const book = makeCommitBook({
    tep: "TEP-cmxela-31",
    runId: "TEP-cmxela-31@abc123",
    branch: "tandem/TEP-cmxela-31",
    worktree: "/wt",
    testerWt: "/wt",
    dag,
    st,
    exec: exec as never,
    log: () => {},
    undelivered,
    done,
    failed,
    standing: new Set(),
    sliceProbes: new Map(),
    sliceFiles: new Map(),
  });

  await book.finishUnit("SL-1#eu-0", "SL-1", true);

  const commit = calls.find((c) => c.args[0] === "commit");
  assert.ok(commit, "a commit must have been made once the slice's last unit finished");
  const msgIndex = commit!.args.indexOf("-m");
  const message = commit!.args[msgIndex + 1];
  const [subject, ...bodyLines] = message.split("\n");

  assert.equal(subject, "tandem: TEP-cmxela-31 SL-1", "the subject is exactly the slice-commit shape");
  assert.match(
    bodyLines.join("\n"),
    /Tandem-Run:\s*TEP-cmxela-31@abc123/,
    "the message body carries the run id as a trailer",
  );
});
