/**
 * A finding reaches the surface as the pair its finder wrote: what was
 * seen, and the ask drafted from it. The report shows both — the ask is
 * the sentence that goes in the capture box, so the person reads it
 * before choosing, rather than ticking a box on a diagnostic alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { emptySpace } from "../core/schema";

function sessionWithFindings(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-findings-"));
  const session = new TandemSession({
    author: "tester",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
  session.space = {
    ...emptySpace(),
    cuts: [{ id: "cut-1", tepId: "TEP-1", changeIds: [] }],
    deliveries: [
      {
        id: "d1",
        cutId: "cut-1",
        branch: "tandem/TEP-1",
        proofs: [],
        findings: [
          { saw: "the delete box never names the task", ask: "Name the task in the delete confirmation" },
          { saw: "the tab title reads Web Application for a moment" },
        ],
        findingsAsked: [],
      },
    ],
  } as never;
  return session;
}

test("a finding carries the ask its finder drafted, beside what was seen", () => {
  const pushed = spacePush(sessionWithFindings()) as {
    deliveries?: { findings?: { text: string; ask?: string; taken?: boolean }[] }[];
  };
  const findings = pushed.deliveries?.[0]?.findings;
  assert.ok(findings, `the delivery carries its findings: ${JSON.stringify(pushed.deliveries)}`);
  assert.deepEqual(findings, [
    { text: "the delete box never names the task", ask: "Name the task in the delete confirmation" },
    { text: "the tab title reads Web Application for a moment" },
  ]);
});

test("the report has somewhere to show the ask, and shows it only where there is one", () => {
  // The component is the only place the pair is read by a person, so the
  // rule is pinned where it is written: the ask is painted under what was
  // seen, and a finding without one stays a note.
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "webview", "map", "src", "Delivery.tsx"), "utf8");
  assert.match(src, /data-finding-ask=\{i\}/, "the ask has its own element to be read and tested through");
  assert.match(src, /Ask: \{f\.ask\}/, "and the drafted sentence itself is painted, not just carried");
  assert.match(src, /\{f\.ask \? \(/, "only where the finder drafted one");
});
