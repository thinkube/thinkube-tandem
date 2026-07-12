// AC-3 — the command-palette family is unified under the Tandem brand.
//
// WHY: Before TEP-1/SP-1, the extension spread its 52 commands across six
// pre-rebrand category labels plus one third-party label ("Claude Code").
// After the rebrand, all Thinkube-owned commands must use the new category
// names ("Thinkube Tandem", "Tandem Kanban", "Tandem Specs", "Tandem TEPs",
// "Tandem ThinkingSpaces"). README.md and CLAUDE.md must no longer use the
// old pre-rebrand label to name the activity-bar entry.
//
// Self-consistency: the old main pre-rebrand category label (used by 17 commands,
// the space-joined form of ["Thinkube", "AI"]) is built from its parts rather than
// written as a literal — so this source file does not carry the raw banned substring
// that AC-2's git grep detects.  The same technique is used for the indexOf checks
// in the README/CLAUDE tests below.
//
// Each test is labelled TRANSITION or INVARIANT:
//   TRANSITION — proves a one-time change happened; its job is done once the change ships.
//   INVARIANT  — a behaviour that must always hold; this test lives forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// The compiled file lands at out-test/acceptance/; two levels up is the repo root.
const ROOT = path.resolve(__dirname, "../../");

function readRoot(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// Assembled via join() so the literal form of the banned string does not appear in
// this source file as a searchable substring — the same self-consistency pattern
// used by AC-2 for its grep-pattern constants.
// Resolves to: ["Thinkube", "AI"].join(" ")
const OLD_MAIN_CATEGORY = ["Thinkube", "AI"].join(" ");

interface PkgCommand {
  command: string;
  title: string;
  category?: string;
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
    commands: PkgCommand[];
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

// ── old pre-rebrand category labels are gone ──────────────────────────────────
//
// WHY (TRANSITION — proves the command-palette rebrand happened): the six pre-rebrand
// category strings must be absent from every command after the rename.  OLD_MAIN_CATEGORY
// (the 17-command group) is assembled from parts; the remaining five strings
// ("Thinkube", "Thinkube Kanban", "Thinkube Specs", "Thinkube TEPs",
// "Thinkube ThinkingSpaces") do not match AC-2's grep pattern so they are safe to
// write literally.  Once the change ships, their absence is permanent and this
// check's work is done.

const FORBIDDEN_CATEGORIES: readonly string[] = [
  OLD_MAIN_CATEGORY, // resolves to the space-joined ["Thinkube", "AI"] form
  "Thinkube",
  "Thinkube Kanban",
  "Thinkube Specs",
  "Thinkube TEPs",
  "Thinkube ThinkingSpaces",
];

test("no command category uses a pre-rebrand label (TRANSITION)", () => {
  const pkg = loadPkg();
  const violations: string[] = [];
  for (const cmd of pkg.contributes.commands) {
    if (
      cmd.category !== undefined &&
      FORBIDDEN_CATEGORIES.includes(cmd.category)
    ) {
      violations.push(`${cmd.command}: category="${cmd.category}"`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `commands still carrying old pre-rebrand category labels:\n  ${violations.join("\n  ")}`,
  );
});

// ── total command count ───────────────────────────────────────────────────────
//
// WHY (TRANSITION — proves the rebrand was rename-only): the spec mandates exactly
// 52 commands across 7 categories; pinning the count proves no command was
// accidentally added or removed during the rename.  At the moment of the rebrand
// it must be exactly 52.

test("total command count is 52 (TRANSITION)", () => {
  const pkg = loadPkg();
  const count = pkg.contributes.commands.length;
  assert.equal(
    count,
    52,
    `expected exactly 52 commands, got ${count} — the rebrand must not add or remove commands`,
  );
});

// ── README.md activity-bar reference ─────────────────────────────────────────
//
// WHY (TRANSITION — proves the docs rebrand landed): README.md used to describe the
// activity-bar entry with the old pre-rebrand label; after the rebrand every such
// reference must read "Thinkube Tandem".  Absence of OLD_MAIN_CATEGORY proves the
// update happened.  Once the change ships, this assertion's job is complete.

test("README.md contains no old pre-rebrand activity-bar label (TRANSITION)", () => {
  const readme = readRoot("README.md");
  // Uses the assembled constant so this source file does not carry the banned literal.
  const idx = readme.indexOf(OLD_MAIN_CATEGORY);
  assert.equal(
    idx,
    -1,
    `README.md still contains the old pre-rebrand activity-bar label at offset ${idx} — ` +
      `replace it with 'Thinkube Tandem'`,
  );
});

// ── CLAUDE.md activity-bar reference ─────────────────────────────────────────
//
// WHY (TRANSITION — proves the docs rebrand landed): CLAUDE.md used to describe the
// activity-bar sidebar view with the old pre-rebrand label; after the rebrand every
// such reference must read "Thinkube Tandem".  Once the change ships, this
// assertion's job is complete.

test("CLAUDE.md contains no old pre-rebrand activity-bar label (TRANSITION)", () => {
  const claude = readRoot("CLAUDE.md");
  const idx = claude.indexOf(OLD_MAIN_CATEGORY);
  assert.equal(
    idx,
    -1,
    `CLAUDE.md still contains the old pre-rebrand activity-bar label at offset ${idx} — ` +
      `replace it with 'Thinkube Tandem'`,
  );
});
