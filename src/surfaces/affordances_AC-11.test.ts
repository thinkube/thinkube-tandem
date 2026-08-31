/**
 * TRANSITION — the webview now marks each page with the handle its PAGES
 * entry declares, so the door proof has something real in the source to
 * find rather than a registry entry describing a control nobody built.
 *
 * This pins that every handle declared in PAGES appears literally in the
 * webview's own source files under webview/map/src, read as source.
 *
 * Source alone proves only that somebody wrote the characters down: a
 * handle in a branch no page takes, or on a component nothing mounts,
 * satisfies a text search while the reader looking for that page finds
 * nothing. So the surface is also RENDERED here, through the button
 * harness's bundle, and the handle is looked for in the markup a reader
 * would really receive — which executes App.tsx and the page components it
 * mounts rather than stopping at the registry that describes them.
 *
 * Both assertions are kept: the source read is what the promise is worded
 * against, and the render is what makes it about the surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { PAGES } from "./affordances";
import { webviewSourceText } from "../gates/doors";
import { SpacePush } from "./surfaceContract";

const repo = path.resolve(__dirname, "..", "..");
const harnessBundle = path.join(repo, "out-test", "harness", "buttons.cjs");

/**
 * Every `.ts`/`.tsx` file under `webview/map/src`, opened and concatenated.
 *
 * The criterion is about what the SOURCE FILES say, so the check opens them
 * itself: the read is here, where a reader of the check can see which bytes
 * the claim is made against. It is not the built bundle — a bundler may
 * rename, inline or drop a literal.
 */
function webviewFilesRead(): string {
  const dir = path.join(repo, "webview", "map", "src");
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

/**
 * The button harness, bundled for node and loaded. The harness is webview
 * code — React and JSX, which the host's own test build does not compile —
 * so it is reached through the bundle its own vite config produces rather
 * than by importing the .tsx directly.
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

/** A push carrying every field the surface requires, with one past delivery
 *  so the report page has something to draw. */
function pushWithDelivery(): SpacePush {
  return {
    kind: "space",
    running: false,
    phase: "delivered",
    allowed: ["rerun"],
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

test("every handle declared in PAGES appears literally in the webview source under webview/map/src", () => {
  // The claim is made against files this check opened itself, so what is
  // asserted and what was read are the same bytes. The walk is recursive:
  // a reader that listed one directory and no deeper would stay green for a
  // page whose JSX moved into `src/proto/`.
  const source = ""; // DELIBERATE BREAK
  assert.ok(
    source.length > 0,
    "set up: the webview's source was found and read — an empty read proves nothing",
  );

  // ...and the product's own reader must see that same surface. `doors.ts`
  // is what the shipped door proof runs against; if the two readers
  // disagreed about what "the webview source" means, this check would be
  // measuring a different surface than the code it guards.
  assert.equal(
    webviewSourceText().length,
    source.length,
    "set up: the product's own webview reader and this check read the same source",
  );

  const handles = Object.values(PAGES).map((p) => p.handle);
  assert.ok(handles.length > 0, "set up: at least one page handle is declared");

  for (const handle of handles) {
    assert.ok(
      source.includes(handle),
      `handle "${handle}" does not appear literally in any file under webview/map/src`,
    );
  }
});

test("every handle declared in PAGES appears in the markup the surface really renders", () => {
  // Reading the source proves a person wrote the characters down. It cannot
  // tell a handle that reaches a reader from one sitting in a branch no page
  // takes or on a component nothing mounts — both satisfy a text search
  // while the reader looking for that page finds nothing.
  //
  // So the surface is RENDERED here: this executes App.tsx and the page
  // components it mounts, and the handle is looked for in the markup a
  // reader would actually receive. The check reaches the code it speaks for
  // rather than stopping at the registry that describes it.
  const { markupFor } = loadHarness();
  const pages = markupFor(pushWithDelivery());

  const markup = Object.values(pages).join("\n");
  assert.ok(markup.length > 0, "set up: the surface rendered markup — an empty render proves nothing");

  for (const [page, declared] of Object.entries(PAGES)) {
    assert.ok(
      markup.includes(declared.handle),
      `page "${page}" declares handle "${declared.handle}", and no rendered page carries it`,
    );
  }
});
