/**
 * What the documentation duty means, and the failure it exists to catch.
 *
 * The rule used to read "any path under docs/". This repository keeps its
 * maintainer notes and its published site under that one directory, so a
 * line added to an internal audit satisfied the duty completely and the
 * pages a person reads never had to move. Four user pages went stale
 * describing behaviour that had changed underneath them, and every cut
 * along the way was signed with its documentation duty met.
 *
 * The drive below fails if that becomes possible again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configureDocsRoots, docsDuty, userDocsRoots } from "./docsDuty";
import { emptySpace } from "./schema";
import type { Cut, Space } from "./schema";

/** A space holding one change that lands on the given paths. */
function spaceLanding(...paths: string[]): { space: Space; cut: Cut } {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change",
        serves: [],
        needs: [],
        acceptance: [],
        grounding: { touchpoints: paths.map((p) => ({ path: p })) },
      } as unknown as Space["nodes"][number],
    ],
  };
  return { space, cut: { id: "c1", changeIds: ["n1"] } as Cut };
}

test("a repository's published pages are found from its own documentation system", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  fs.mkdirSync(path.join(repo, "docs", "modules", "ROOT", "pages"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "antora.yml"), "name: thing\n");
  // Maintainer notes sit beside the site, under the same directory.
  fs.writeFileSync(path.join(repo, "docs", "PROCESS.md"), "# process\n");

  assert.deepEqual(userDocsRoots(repo), ["docs/modules"]);
});

test("a marker whose pages directory was never created names no place", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "antora.yml"), "name: thing\n");
  assert.deepEqual(userDocsRoots(repo), []);
});

test("an internal note under docs/ no longer satisfies the duty", () => {
  configureDocsRoots(["docs/modules"]);
  const { space, cut } = spaceLanding("src/run/gate.ts", "docs/SURFACE.md");
  const duty = docsDuty(space, cut);
  assert.equal(duty.state, "missing");
  assert.deepEqual(duty.landings, []);
  configureDocsRoots(undefined);
});

test("a change in the published pages satisfies it", () => {
  configureDocsRoots(["docs/modules"]);
  const { space, cut } = spaceLanding("src/run/gate.ts", "docs/modules/ROOT/pages/gates.adoc");
  const duty = docsDuty(space, cut);
  assert.equal(duty.state, "landed");
  assert.deepEqual(duty.landings, ["docs/modules/ROOT/pages/gates.adoc"]);
  configureDocsRoots(undefined);
});

test("a repository that publishes nothing keeps the plain reading", () => {
  configureDocsRoots([]);
  const { space, cut } = spaceLanding("docs/NOTES.md");
  assert.equal(docsDuty(space, cut).state, "landed");
  configureDocsRoots(undefined);
});

test("an exemption still settles a cut that lands no documentation", () => {
  configureDocsRoots(["docs/modules"]);
  const { space, cut } = spaceLanding("src/run/gate.ts");
  const duty = docsDuty(space, {
    ...cut,
    docsExemption: { reason: "nothing a person sees changes", at: "2026-08-28T00:00:00Z" },
  } as Cut);
  assert.equal(duty.state, "exempt");
  assert.equal(duty.reason, "nothing a person sees changes");
  configureDocsRoots(undefined);
});

test("a root's name is not a prefix of another directory's", () => {
  configureDocsRoots(["docs/modules"]);
  const { space, cut } = spaceLanding("docs/modules-archive/old.adoc");
  assert.equal(docsDuty(space, cut).state, "missing");
  configureDocsRoots(undefined);
});
