/**
 * TRANSITION — every human door's handle now appears in the webview source,
 * or its action is posted from the control as a quoted string, so the proof
 * has something real to find for controls too, not only pages.
 *
 * This pins that for each human door in AFFORDANCES, either its handle
 * (data-<action>) appears literally in webview/map/src, or the action name
 * appears there as a quoted string (the shape a postMessage call takes).
 *
 * Source alone proves only that somebody wrote the characters down: a handle
 * in a branch no page takes, or on a component nothing mounts, satisfies a
 * text search while the person looking for that door finds nothing. A door
 * is a place to ACT, so the surface is also RENDERED here, through the
 * button harness's bundle — which executes App.tsx and the page components
 * it mounts rather than stopping at the registry that describes them.
 *
 * Both are kept: the source read is what the promise is worded against, and
 * the render is what makes it about a door a person can really reach.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { AFFORDANCES } from "./affordances";
import { webviewSourceText } from "../gates/doors";
import { SpacePush } from "./surfaceContract";

const repo = path.resolve(__dirname, "..", "..");
const harnessBundle = path.join(repo, "out-test", "harness", "buttons.cjs");

/**
 * The button harness, bundled for node and loaded. The harness is webview
 * code — React and JSX, which the host's own test build does not compile —
 * so it is reached through the bundle its own vite config produces.
 *
 * A failure to build is raised, never swallowed: a check that quietly skips
 * when it cannot reach its subject is green for a stub as readily as for the
 * real surface.
 */
function loadHarness(): { markupFor(push: SpacePush): Record<string, string> } {
  if (!fs.existsSync(harnessBundle)) {
    execFileSync("npm", ["run", "buttons"], {
      cwd: path.join(repo, "webview", "map"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(harnessBundle);
}

/** A push carrying every field the surface requires, with one undecided
 *  delivery so the report page draws its doors. */
function pushWithDelivery(): SpacePush {
  return {
    kind: "space",
    running: false,
    phase: "delivered",
    allowed: ["rerun", "accept-delivery", "reject-delivery"],
    signedTeps: 1,
    questions: [],
    decisions: [],
    orphans: [],
    sentences: [],
    cost: { subjects: 0, rounds: 0 },
    outOfDate: { promises: 0, subjects: 0, rounds: 0 },
    ready: { subjects: 0, promises: 0, asks: 0, thinking: false },
    draft: "",
    impacts: [{ id: "i1", title: "an implication", state: "staged" }],
    subjects: [],
    cutCount: 1,
    deliveries: [{ id: "d1", title: "a delivery", page: "# What landed\n\nA line." }],
    documentation: { state: "landed", landings: [] },
  } as unknown as SpacePush;
}

/**
 * Every `.ts`/`.tsx` file under `webview/map/src`, opened and concatenated.
 *
 * The criterion is about what the SOURCE FILES say, so the check opens them
 * itself: the read is here, in the check, where a reader of the check can
 * see which bytes the claim is made against. It is not the built bundle —
 * a bundler may rename, inline or drop a literal.
 */
function webviewFilesRead(): string {
  const dir = path.resolve(__dirname, "..", "..", "webview", "map", "src");
  const parts: string[] = [];
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) parts.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return parts.join("\n");
}

test("every handle of a human door in AFFORDANCES appears literally in the webview source, or its action is posted as a quoted string", () => {
  // The claim is made against files this check opened itself, so what is
  // asserted and what was read are the same bytes.
  const source = webviewFilesRead();
  assert.ok(
    source.length > 0,
    "set up: the webview's source was found and read — an empty read proves nothing",
  );

  // ...and the product's own reader must see that same surface. `doors.ts`
  // is what the shipped door proof runs against; if the two readers
  // disagreed about what "the webview source" means, this check would be
  // measuring a different surface than the code it guards, and only this
  // check would be happy.
  const viaProduct = webviewSourceText();
  assert.equal(
    viaProduct.length,
    source.length,
    "set up: the product's own webview reader and this check read the same source",
  );

  const humanEntries = Object.entries(AFFORDANCES).filter(([, e]) => e.kind === "human");
  assert.ok(humanEntries.length > 0, "set up: at least one human door is declared");

  for (const [action] of humanEntries) {
    const handle = `data-${action}`;
    const quotedAction = `"${action}"`;
    assert.ok(
      source.includes(handle) || source.includes(quotedAction),
      `door "${action}" has neither its handle "${handle}" nor its quoted action ${quotedAction} in webview/map/src`,
    );
  }
});

test("the delivery doors a reader is offered really render, handle and all", () => {
  // A door is a place to ACT, and the source read above cannot tell a handle
  // that reaches a reader from one sitting on a component nothing mounts.
  // So the surface is rendered — which executes App.tsx and the page
  // components it mounts — and the doors this push offers are looked for in
  // the markup a reader would actually receive.
  //
  // The doors asserted here are the ones a delivered space really draws.
  // Every other human door belongs to a phase or a state this push is not
  // in, and demanding those from one render would be asserting something
  // false about the surface rather than proving anything about the doors.
  const { markupFor } = loadHarness();
  const markup = Object.values(markupFor(pushWithDelivery())).join("\n");
  assert.ok(markup.length > 0, "set up: the surface rendered markup — an empty render proves nothing");

  const humanDoors = new Set(
    Object.entries(AFFORDANCES).filter(([, e]) => e.kind === "human").map(([a]) => a),
  );
  for (const action of ["accept-delivery", "reject-delivery"]) {
    assert.ok(
      humanDoors.has(action),
      `set up: "${action}" is a human door in AFFORDANCES — this check is about doors`,
    );
    assert.ok(
      markup.includes(`data-${action}`),
      `door "${action}" is offered on a delivered space, and no rendered page carries its handle "data-${action}"`,
    );
  }
});
