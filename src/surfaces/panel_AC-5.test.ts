/**
 * With several thinking spaces open at once, the status line must report
 * every space's activity, not hide the rest behind whichever one is
 * active: a session parked on a question always needs a person's
 * attention, and that must remain visible even while another space's
 * session is still building — neither state may swallow the other.
 *
 * STANDING INVARIANT — across the open sessions, a session whose run has a
 * parked unit is always distinguishable, through its own runState.view(),
 * from a session whose run is still building with nothing parked; reading
 * one session's state must never depend on, or erase, the other's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession, SessionDeps } from "./session";
import { RunState } from "../run/state";
import { sessionStatusOf, statusLine } from "../hostui/hostDecisions";
import { spacePush } from "./push";

/**
 * `extension.ts` imports `vscode`, which exists only inside the editor
 * host. Standing this minimal double in the loader before it is required is
 * what lets the REAL `heartbeat` be driven here: the rule that both spaces
 * are reported is only worth proving where the host actually renders it.
 */
function installVscodeStub(): void {
  const stub = {
    ThemeColor: class {
      constructor(public readonly id: string) {}
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      showInformationMessage: () => Promise.resolve(undefined),
      showWarningMessage: () => Promise.resolve(undefined),
    },
    commands: { executeCommand: () => Promise.resolve(undefined) },
    workspace: {
      workspaceFolders: [],
      asRelativePath: (p: string) => p,
      getConfiguration: () => ({ get: () => undefined }),
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

test("a status line built from two sessions, one building and one parked on a question, must report both states rather than only one", () => {
  const dirBuilding = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-status-building-"));
  const dirParked = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-status-parked-"));
  const building = new TandemSession(fakeDeps(dirBuilding));
  const parked = new TandemSession(fakeDeps(dirParked));

  building.running = true;
  building.runState = new RunState(() => {});
  building.runState.seed("u1", "SL-1", "code");
  building.runState.set("u1", "running");

  parked.running = true;
  parked.runState = new RunState(() => {});
  parked.runState.seed("u2", "SL-2", "code");
  parked.runState.park("u2", "which file should this land in?", () => {});

  const all = [building, parked];

  // The line for several open spaces must be able to tell these two states
  // apart — a worker waiting for a person is never the same fact as a
  // worker still running — and it must see BOTH sessions, not just one.
  const withParked = all.filter(
    (s) => s.running && s.runState && s.runState.view().parked.length > 0,
  );
  const stillBuilding = all.filter(
    (s) => s.running && s.runState && s.runState.view().parked.length === 0,
  );

  assert.deepEqual(withParked, [parked], "the parked session must be reported as needing an answer");
  assert.deepEqual(withParked.length, 1);
  assert.deepEqual(stillBuilding, [building], "the building session must still be reported, not hidden by the parked one");
  assert.deepEqual(stillBuilding.length, 1);

  // Reading the parked session's view must not have disturbed the building
  // session's own state, and vice versa.
  assert.equal(building.runState.view().parked.length, 0);
  assert.equal(parked.runState.view().parked.length, 1);

  // The line the host actually renders must say BOTH facts. Reporting only
  // the parked space, or only the building one, is the failure this guards.
  // Built through the SAME step the host uses to turn a session into a
  // status row (`sessionStatusOf`), not a copy of it written here: a
  // reimplementation in the test would stay green if the host's own
  // mapping started reading only the active session.
  const line = statusLine(all.map(sessionStatusOf));
  assert.ok(line, "two live sessions must produce a status line");
  assert.match(line!.text, /needs your answer/, "the parked space must be reported");
  assert.match(line!.text, /building/, "the building space must be reported too");
  assert.equal(line!.warning, true, "a space waiting on a person must show the warning colour");

  // Order-independence: the same two states must be reported whichever
  // session happens to be listed first.
  const reversed = statusLine([...all].reverse().map(sessionStatusOf));
  assert.equal(reversed!.text, line!.text, "the line must not depend on which space is active");

  // The same two states must survive the real payload builder each space's
  // own tab is sent. The status line and the per-space push read the same
  // session state, and both must keep the two spaces apart: a push that
  // reported the active session's run for every space would leave the line
  // above green while every tab showed the wrong space's work.
  const pushBuilding = spacePush(building) as { run?: { units: { state: string }[] } };
  const pushParked = spacePush(parked) as {
    run?: { units: { state: string }[]; parked?: unknown[] };
  };

  assert.ok(pushBuilding.run, "the building space's push must carry its own run");
  assert.ok(pushParked.run, "the parked space's push must carry its own run");
  assert.deepEqual(
    pushBuilding.run!.units.map((u) => u.state),
    ["running"],
    "the building space's push must report it still running",
  );
  assert.notDeepEqual(
    pushBuilding.run,
    pushParked.run,
    "two spaces in different states must produce two different pushes, not one shared state",
  );

  // The rule must hold where the host ACTUALLY renders it. Everything above
  // drives the decision functions; this drives the real `heartbeat` in
  // `extension.ts` — the code this promise lands in — over both sessions,
  // and reads the status bar it wrote. A heartbeat that reported only the
  // active session passes every assertion above and fails here.
  installVscodeStub();
  const ext = require("../extension") as typeof import("../extension");

  const bar = {
    text: "",
    backgroundColor: undefined as unknown,
    shown: 0,
    show() {
      bar.shown += 1;
    },
    hide() {},
    dispose() {},
  };
  const fakeContext = {
    workspaceState: { get: () => undefined, update: () => Promise.resolve() },
    subscriptions: [],
  };

  ext.__setHostState({
    sessions: [
      ["repo-a/building", building],
      ["repo-a/parked", parked],
    ],
    statusBar: bar as never,
    context: fakeContext as never,
  });

  ext.heartbeat(fakeContext as never);

  assert.match(bar.text, /needs your answer/, "the host's own status bar must report the parked space");
  assert.match(bar.text, /building/, "the host's own status bar must report the building space too");
  assert.ok(bar.backgroundColor, "a space waiting on a person must set the warning background");
  assert.equal(bar.shown >= 1, true, "the status bar must be shown");
  assert.equal(
    bar.text,
    line!.text,
    "the line the host renders must be the same line the rule produced",
  );
});
