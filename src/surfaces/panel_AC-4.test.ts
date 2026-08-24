/**
 * A delivery-ready notice must name the space it came from and its open
 * gesture must reveal that space's own tab — never whichever space happens
 * to be active — because a build can finish in a background space while a
 * different one is in front. The registry is what "reveal this space's
 * tab" means: opening a key must always resolve to the tab registered
 * under that same key, and spaceLabel is what "name that space" reads
 * from — the name the person actually gave it, not a directory spelling.
 *
 * STANDING INVARIANT — the key a delivery-ready notice targets must always
 * resolve, through SpaceTabs, to the tab of the space that produced it,
 * and the label a notice would show for that key must always be the name
 * recorded for that specific space, whichever space is active.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpaceTabs } from "./panels";
import { spaceLabel } from "../core/spaces";
import { changeNotice } from "../hostui/hostDecisions";
import { TandemSession, SessionDeps } from "./session";
import { spacePush } from "./push";

/** What the real host showed, captured from the vscode double below. */
const shown: { kind: string; text: string }[] = [];
/** What the host ran when the person took the notice's open gesture. */
const invoked: unknown[][] = [];

/**
 * `extension.ts` imports `vscode`, which exists only inside the editor
 * host. Standing this minimal double in the loader before it is required is
 * what lets the REAL `pushChanged` be driven here: naming and targeting the
 * source space is only worth proving where the host actually raises it.
 */
function installVscodeStub(storeRoot: string): void {
  const stub = {
    ThemeColor: class {
      constructor(public readonly id: string) {}
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      showInformationMessage: (text: string) => {
        shown.push({ kind: "information", text });
        // The person takes the offered way in.
        return Promise.resolve("Open the space");
      },
      showWarningMessage: (text: string) => {
        shown.push({ kind: "warning", text });
        return Promise.resolve(undefined);
      },
    },
    commands: {
      executeCommand: (...args: unknown[]) => {
        invoked.push(args);
        return Promise.resolve(undefined);
      },
    },
    workspace: {
      workspaceFolders: [],
      asRelativePath: (p: string) => p,
      getConfiguration: () => ({
        get: (key: string, fallback?: unknown) =>
          key === "storeRoot" ? storeRoot : fallback,
      }),
    },
    TreeItem: class {
      constructor(
        public label: string,
        public collapsibleState: number,
      ) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class {
      constructor(public readonly icon: string) {}
    },
    EventEmitter: class {
      event = () => ({ dispose: () => {} });
      fire() {}
      dispose() {}
    },
    Uri: { joinPath: (...p: unknown[]) => ({ fsPath: p.join("/") }) },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
  };
  const Mod = require("node:module") as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const realLoad = Mod._load;
  Mod._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "vscode") return stub;
    return realLoad.call(this, request, parent, isMain);
  };
}

function fakeDeps(dir: string): SessionDeps {
  return {
    round: { model: "fake-model", repoRoot: dir },
    storeDir: path.join(dir, "store"),
    storageDir: path.join(dir, "storage"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  };
}

interface FakeTab {
  key: string;
  title: string;
  revealed: number;
  reveal(): void;
  push(payload: unknown): void;
  dispose(): void;
}

function fakeFactory(made: FakeTab[]): (key: string, title: string) => FakeTab {
  return (key, title) => {
    const tab: FakeTab = {
      key,
      title,
      revealed: 0,
      reveal() {
        tab.revealed += 1;
      },
      push() {},
      dispose() {},
    };
    made.push(tab);
    return tab;
  };
}

test("a change pushed for a space other than the active one names that space and its open gesture targets that space's key, not the active one", async () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-notice-"));
  const activeDir = path.join(storeRoot, "spaces", "repo-a", "active-space");
  const backgroundDir = path.join(storeRoot, "spaces", "repo-a", "background-space");
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(backgroundDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, "name.txt"), "Active Space\n");
  fs.writeFileSync(path.join(backgroundDir, "name.txt"), "Background Space\n");

  const made: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(made));
  tabs.open("repo-a/active-space", "Active Space");
  tabs.open("repo-a/background-space", "Background Space");

  // The delivery finished in the BACKGROUND space while the ACTIVE space
  // is the one in front — the notice must still name and target the
  // background space, not whichever one is active.
  const sourceKey = "repo-a/background-space";
  const noticeLabel = spaceLabel(storeRoot, "repo-a", "background-space");
  assert.equal(noticeLabel, "Background Space", "the notice must name the space it actually came from");
  assert.notEqual(noticeLabel, "Active Space");

  // The notice the host actually raises must carry that space's name and an
  // open gesture bound to that space's own key.
  const notice = changeNotice(sourceKey, noticeLabel, "Delivery ready for review");
  assert.ok(notice, "a delivery-ready change must produce a notice");
  assert.equal(notice!.kind, "information");
  assert.match(notice!.text, /Background Space/, "the notice must name the space it came from");
  assert.doesNotMatch(notice!.text, /Active Space/, "the notice must not name the active space");
  assert.equal(notice!.open?.ownerId, "repo-a");
  assert.equal(notice!.open?.slug, "background-space", "the open gesture must target the source space's key");

  // Acting on that gesture must land in the source space's own tab.
  const targeted = tabs.open(`${notice!.open!.ownerId}/${notice!.open!.slug}`, noticeLabel);
  const backgroundTab = made.find((t) => t.key === "repo-a/background-space")!;
  const activeTab = made.find((t) => t.key === "repo-a/active-space")!;
  assert.equal(targeted, backgroundTab, "the open gesture must resolve to the source space's own tab");
  assert.equal(backgroundTab.revealed >= 1, true);
  assert.equal(activeTab.revealed, 0, "the active space's tab must not be revealed by a notice from another space");

  // The delivery-ready change must also DELIVER to the source space's tab
  // and to no other, carrying the real payload the production builder makes
  // for that session. This is the second half of the same promise: naming
  // the right space is worthless if the change is pushed to the wrong tab.
  // Driven through `spacePush` — the actual builder — rather than a literal,
  // so the check cannot pass against a push that carries nothing.
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-notice-session-"));
  const sourceSession = new TandemSession(fakeDeps(sourceDir));
  sourceSession.stageOf("ask-bg")("reading the code", 1, 2);

  const delivered: { key: string; payload: unknown }[] = [];
  for (const t of made) t.push = (payload: unknown) => delivered.push({ key: t.key, payload });

  tabs.pushTo(sourceKey, spacePush(sourceSession, "Delivery ready for review"));

  assert.deepEqual(
    delivered.map((d) => d.key),
    [sourceKey],
    "the change must reach the source space's tab and no other open tab",
  );
  const payload = delivered[0].payload as {
    message?: string;
    activity?: { askId?: string };
  };
  assert.equal(payload.message, "Delivery ready for review", "the delivered payload must carry the change's message");
  assert.equal(
    payload.activity?.askId,
    "ask-bg",
    "the delivered payload must be built from the source session's own state, not the active space's",
  );

  // The rule must hold where the host ACTUALLY raises the notice. Everything
  // above drives the decision functions; this drives the real `pushChanged`
  // in `extension.ts` — the code this promise lands in — for the BACKGROUND
  // space while a different space is in front, and reads the notice the host
  // showed and the command it ran. A host that named or targeted the active
  // space passes every assertion above and fails here.
  installVscodeStub(storeRoot);
  const ext = require("../extension") as typeof import("../extension");

  const hostDelivered: { key: string; payload: unknown }[] = [];
  for (const t of made) t.push = (p: unknown) => hostDelivered.push({ key: t.key, payload: p });

  shown.length = 0;
  invoked.length = 0;
  ext.__setHostState({
    sessions: [[sourceKey, sourceSession]],
    tabs: tabs as never,
    statusBar: { text: "", show() {}, hide() {}, dispose() {} } as never,
    context: {
      workspaceState: { get: () => undefined, update: () => Promise.resolve() },
      subscriptions: [],
    } as never,
  });

  ext.pushChanged(sourceKey, "Delivery ready for review");
  // The open gesture is taken on the notification's promise.
  await new Promise((r) => setImmediate(r));

  assert.equal(shown.length, 1, "the host must raise exactly one notice");
  assert.equal(shown[0].kind, "information");
  assert.match(shown[0].text, /Background Space/, "the host's notice must name the space the change came from");
  assert.doesNotMatch(shown[0].text, /Active Space/, "the host's notice must not name the active space");

  assert.equal(invoked.length, 1, "taking the notice's way in must run the open command");
  assert.deepEqual(
    invoked[0],
    ["thinkube-tandem.openThinkingSpace", "repo-a", "background-space"],
    "the host's open gesture must target the source space's own key",
  );

  assert.deepEqual(
    hostDelivered.map((d) => d.key),
    [sourceKey],
    "the host must push to the source space's tab and no other",
  );
});
