/**
 * The walk: every press a person makes, in order, over a real session and
 * a real store, with the model's rounds replaced by recorded answers.
 *
 * After every press it asks what the person now sees — the one label on
 * the strip, the page, how many things, which sentences sit under which,
 * what is pending — and not what any one function returned. The unit
 * suite pins pieces; this pins the sequence, which is where a re-reading
 * that left things pointing at nothing, a strip saying "Keep these 0" and
 * a grouping running with nothing on screen all lived while every piece
 * passed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TandemSession } from "./session";
import { handleInbound } from "./inbound";
import { spacePush } from "./push";
import { nextAction } from "./nextAction";
import { pageFor } from "./pageFor";
import type { SpacePush } from "./surfaceContract";
import type { InboundAction } from "./inbound";
import type { Change, Delivery } from "../core/schema";

const SENTENCES = [
  "My tasks come back in a sensible order — what is due soonest first.",
  "A task that is past its due date is obvious at a glance.",
  "Finished tasks stop crowding the ones I still have to do.",
  "I can see how many tasks I have without counting cards.",
  "I can look at just the high priority ones when I want to.",
  "When I open the new-task box the cursor is already in the title.",
  "I can add a task with the keyboard alone.",
  "If I try to save a task with no title it tells me.",
  "Deleting a task asks me first.",
];

/** The reading, as the model would answer it: three subjects, one claim per sentence. */
function reading(texts: string[]) {
  const subject = (name: string, from: number[]) => ({
    name,
    from,
    claims: from.map((n) => ({ text: `${texts[n - 1].replace(/\.$/, "")}`, from: n, quote: texts[n - 1] })),
  });
  return {
    subjects: [subject("my tasks", [1, 2, 3, 4, 5]), subject("the new-task box", [6, 7, 8]), subject("deleting a task", [9])],
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

/** A repository with an origin, as an app checkout has. */
function repository(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-walk-"));
  const origin = path.join(dir, "origin.git");
  const root = path.join(dir, "todo");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, root]);
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  fs.mkdirSync(path.join(root, "backend/app/api"), { recursive: true });
  fs.writeFileSync(path.join(root, "backend/app/api/tasks.py"), "def list_tasks():\n    pass\n");
  fs.writeFileSync(path.join(root, "thinkube.yaml"), "apiVersion: thinkube.io/v1\nkind: ThinkubeDeployment\nspec:\n  deployment:\n    type: none\n  parts:\n    - root: .\n      test:\n        one: 'pytest <file>'\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "push", "-q", "-u", "origin", "main");
  return root;
}

function session(root: string): TandemSession {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-walk-store-"));
  let tep = 0;
  const s: TandemSession = new TandemSession({
    author: "me",
    round: { model: "m", repoRoot: root },
    storeDir: path.join(store, "test", "me"),
    projectDir: path.join(store, "test"),
    storageDir: path.join(store, ".local"),
    now: () => new Date().toISOString(),
    scope: { gitRoot: root, prefix: "", projectId: "todo-x", label: "todo" },
    nextTepNumber: () => ++tep,
    retire: async () => {},
    solveModel: async (_deps: unknown, texts: string[]) => reading(texts),
    proposeSpecs: async (_deps: unknown, space: { subjects?: { id: string; name: string }[] }) => ({
      specs: (space.subjects ?? []).map((sub) => ({ name: `Thing for ${sub.name}`, subjectIds: [sub.id] })),
      loose: [],
    }),
    knowledge: async () => ({
      repoRoot: root,
      graph: {} as never,
      map: "",
      digest: "a small app",
      provision: "",
      prepare: "",
      runOne: "pytest <file>",
      build: "",
      suite: "",
      suiteReds: [],
      rememberSuiteReds: () => {},
      resetup: async () => ({ provision: "", prepare: "", runOne: "pytest <file>", suite: "" }),
      proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
    // One promise per claim, landing in the one file the app has.
    ground: async (_deps: unknown, ask: { id: string }, opts: { claims?: { id: string; text: string }[]; mintNodeId?: (n: number) => string }) => ({
      changes: (opts.claims ?? []).map((c, i) => {
        const id = opts.mintNodeId!(i + 1);
        const fromAsk = (s.space.claims ?? []).find((x) => x.id === c.id)?.fromAsk;
        return {
          id,
          sentence: `${c.text}.`,
          serves: [ask.id, ...(fromAsk ? [fromAsk] : [])],
          servesClaim: c.id,
          grounding: { touchpoints: [{ path: "backend/app/api/tasks.py", symbol: "list_tasks" }], stamp: [] },
          acceptance: [{ id: `${id}-check-1`, text: `${c.text} — it holds`, kind: "probe" }],
          needs: [],
        } as unknown as Change;
      }),
      questions: [],
    }),
    completeCut: async () => [],
    // The run, replaced: the branch is made with one commit, every check is green.
    dispatch: async (_deps: unknown, space: { nodes: Change[] }, cut: { id: string; tepId?: string; changeIds: string[] }) => {
      const tepId = cut.tepId ?? cut.id;
      const branch = `tandem/todo-x/${tepId}`;
      git(root, "branch", branch);
      const wt = path.join(path.dirname(root), `wt-${tepId}`);
      git(root, "worktree", "add", "-q", wt, branch);
      fs.appendFileSync(path.join(wt, "backend/app/api/tasks.py"), "# sorted\n");
      git(wt, "add", "-A");
      git(wt, "commit", "-q", "-m", `tandem: ${tepId}`);
      git(root, "worktree", "remove", "--force", wt);
      const delivery: Delivery = {
        id: `delivery-${tepId}`,
        cutId: cut.id,
        branch,
        runId: `run-${tepId}`,
        producedAt: new Date().toISOString(),
        proofs: space.nodes
          .filter((n) => cut.changeIds.includes(n.id))
          .flatMap((n) => n.acceptance.map((a) => ({ kind: "probe" as const, label: a.text, verdict: "green" as const, criterionId: a.id }))),
      };
      return { delivery, refusals: [], undelivered: [] };
    },
  } as never);
  return s;
}

/** What the person sees after a press. */
function seen(s: TandemSession) {
  const push = spacePush(s) as SpacePush;
  const strip = nextAction(push, { behind: false, allowed: (a) => push.allowed.includes(a as never) });
  const things = (push.specs ?? []).map((sp) => ({ name: sp.name, asks: sp.asks ?? [], promises: sp.promises, chosen: !!sp.chosen }));
  const inSome = new Set(things.flatMap((t) => t.asks));
  return {
    push,
    strip: strip.label,
    page: pageFor(push),
    things,
    notInAny: push.sentences.map((_, i) => i + 1).filter((n) => !inSome.has(n)),
    pending: !!push.pendingModel,
    promises: push.subjects.reduce((n, sub) => n + sub.claims.reduce((m, c) => m + c.promises.length, 0), 0),
  };
}

async function press(s: TandemSession, action: InboundAction): Promise<string[]> {
  const said: string[] = [];
  await handleInbound(s, action, (m) => {
    if (m) said.push(m);
  });
  return said;
}

/** The run is started by the sign and not awaited by it. */
async function untilRunEnds(s: TandemSession): Promise<void> {
  for (let i = 0; i < 200 && s.running; i++) await new Promise((r) => setTimeout(r, 50));
}

test("the walk: write, read, keep, group, choose, work out, read again, build, run, accept", async () => {
  const root = repository();
  const s = session(root);

  // 1. Nothing written.
  let v = seen(s);
  assert.equal(v.page, "write");

  // 2. Written, not read.
  await press(s, { action: "save-draft", text: SENTENCES.join("\n") });
  v = seen(s);
  assert.equal(v.strip, "Read these 9");

  // 3. Read, not kept: the reading is put to the person.
  await press(s, { action: "read-draft" });
  v = seen(s);
  assert.equal(v.pending, true);
  assert.equal(v.strip, "Keep these 9");

  // 4. Kept: nine sentences, three subjects, nothing pending.
  await press(s, { action: "keep-draft" });
  v = seen(s);
  assert.equal(v.push.sentences.length, 9);
  assert.equal(v.push.subjects.length, 3);
  assert.equal(v.pending, false);
  assert.equal(v.page, "intent");
  assert.equal(v.strip, "Group into things to build");

  // 5. Grouped: three things, every sentence under one of them.
  await press(s, { action: "think" });
  v = seen(s);
  assert.equal(v.things.length, 3);
  assert.deepEqual(v.things.map((t) => t.asks), [[1, 2, 3, 4, 5], [6, 7, 8], [9]]);
  assert.deepEqual(v.notInAny, []);
  assert.equal(v.strip, "Build the first");

  // 6. Chosen: the first thing is in hand, and choosing is what pays for
  //    working it out — one promise per sentence of the thing, plus its
  //    documentation.
  const first = v.push.specs![0].id;
  await press(s, { action: "choose-set", specId: first });
  v = seen(s);
  assert.equal(v.things[0].chosen, true);
  assert.equal(v.page, "work");
  assert.equal(v.push.ready.promises, 6, "five from the sentences and the documentation promise");
  assert.equal(v.strip, "Build these 6");

  // 8. Read again: what the sentences produced goes, the things are proposed
  //    anew, every sentence is under one, and nothing is left pending.
  await press(s, { action: "reread" });
  v = seen(s);
  assert.equal(v.pending, false, "the reading of kept sentences is applied, not put to the person again");
  assert.equal(v.push.subjects.length, 3);
  assert.equal(v.things.length, 3);
  assert.deepEqual(v.notInAny, []);
  assert.equal(v.promises, 0, "the promises of the old reading are gone");
  assert.equal(v.page, "intent");
  assert.equal(v.strip, "Build the first", JSON.stringify({ things: v.things, cutSpecId: s.cutSpecId, cut: [...s.cutNodeIds] }));

  // 9. Chosen and worked out again.
  const again = v.push.specs![0].id;
  await press(s, { action: "choose-set", specId: again });
  v = seen(s);
  assert.equal(v.push.ready.promises, 6);
  assert.equal(v.strip, "Build these 6");

  // 10. Built: signed, run, delivered — the run is the fake's, green.
  await press(s, { action: "build", specId: again });
  await untilRunEnds(s);
  v = seen(s);
  assert.equal(v.push.deliveries.length, 1, JSON.stringify(v.push.runNote ?? v.push.signedIdle));
  assert.equal(v.page, "flow");
  assert.equal(v.strip, "Accept it");

  // 11. Accepted, over a checkout that carries what the run itself left
  //     there — tandem's own facts file, untracked, and an unrelated edit:
  //     the branch is merged into main here and pushed.
  fs.mkdirSync(path.join(root, ".tandem"), { recursive: true });
  fs.writeFileSync(path.join(root, ".tandem/setup.json"), "{}");
  fs.appendFileSync(path.join(root, "thinkube.yaml"), "  deploy:\n    at: https://todo.example\n");
  //     And the remote has moved: the platform's pipeline committed to main.
  const other = path.join(path.dirname(root), "pipeline");
  execFileSync("git", ["clone", "-q", path.join(path.dirname(root), "origin.git"), other]);
  git(other, "config", "user.email", "p@p");
  git(other, "config", "user.name", "pipeline");
  fs.writeFileSync(path.join(other, "k8s.yaml"), "image: 1\n");
  git(other, "add", "k8s.yaml");
  git(other, "commit", "-q", "-m", "build: automatic update");
  git(other, "push", "-q", "origin", "main");
  await press(s, { action: "accept-delivery", deliveryId: v.push.deliveries[0].id });
  v = seen(s);
  assert.equal(v.push.acceptRefusal, undefined, "nothing refused the accept");
  v = seen(s);
  assert.equal(v.push.deliveries[0].accepted, true);
  assert.match(git(root, "log", "--oneline", "-1"), /tandem: accept/);
  assert.equal(git(root, "rev-parse", "main"), git(root, "rev-parse", "origin/main"), "pushed");
  assert.equal(v.page, "intent");
});
