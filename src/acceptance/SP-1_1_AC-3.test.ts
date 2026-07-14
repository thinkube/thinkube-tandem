// AC-3 — the command-palette family is unified under the Tandem brand.
//
// The TEP-1/SP-1 rebrand was a one-time change: it renamed the six pre-rebrand
// command categories to the Tandem names and retitled the activity-bar entry.
// The TRANSITION checks that proved that migration shipped (no pre-rebrand category
// label survived, README/CLAUDE dropped the old label, and the rename added/removed
// no commands — the count was exactly 52) have done their job and were retired: a
// spent one-time guard should not run forever, and the fixed count in particular
// blocks every later spec that legitimately contributes a command.
//
// What remains is the one behaviour that must ALWAYS hold — the activity-bar
// container identity.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// The compiled file lands at out-test/acceptance/; two levels up is the repo root.
const ROOT = path.resolve(__dirname, "../../");

function readRoot(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

interface PkgViewsContainer {
  id: string;
  title: string;
  icon?: string;
}

interface PkgJson {
  contributes: {
    viewsContainers: {
      activitybar: PkgViewsContainer[];
    };
  };
}

function loadPkg(): PkgJson {
  return JSON.parse(readRoot("package.json")) as PkgJson;
}

// ── activity-bar container title ──────────────────────────────────────────────
//
// WHY (INVARIANT — must always hold): the activity-bar container that anchors all
// Tandem sidebar views must be titled "Thinkube Tandem". Any deviation is an
// identity defect visible to every user who opens the activity bar.

test("activity-bar container title is 'Thinkube Tandem' (INVARIANT)", () => {
  const pkg = loadPkg();
  const ab = pkg.contributes.viewsContainers.activitybar;
  assert.ok(
    ab.length > 0,
    "at least one activity-bar container must be declared",
  );
  // The extension registers exactly one activity-bar container (id: 'thinkube').
  const tandem = ab.find((c) => c.id === "thinkube");
  assert.ok(
    tandem !== undefined,
    "activity-bar container with id 'thinkube' must exist",
  );
  assert.equal(
    tandem!.title,
    "Thinkube Tandem",
    "activity-bar container title must be 'Thinkube Tandem'",
  );
});
