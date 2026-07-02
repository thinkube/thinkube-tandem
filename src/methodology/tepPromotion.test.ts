/**
 * `resolveTepWritePath` — the bug the maintainer hit live: a project-scoped
 * `write_tep` for "TEP-1" was refused because an UNRELATED project also happens to
 * have its own "TEP-1" — even though the caller's own `thinking_space:` argument
 * already named exactly which project's TEP-1 was meant. TEP ids are scoped per
 * (thinking space, org)/project, exactly like Spec ids are scoped per-TEP
 * (`promoteTep` itself RE-numbers on promotion for this reason) — two different
 * projects independently minting their own "TEP-1" is normal, not a collision.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveTepWritePath, PROMOTE_TOOL } from "./tepPromotion";
import {
  ThinkingSpaceRegistry,
  writeTep,
  dispatchTool,
} from "../mcp/kanbanMcpServer";

test("resolveTepWritePath: a caller-project-scoped write is authoritative — an unrelated project's same-numbered TEP never vetoes it", () => {
  // Two independent projects, each with their OWN "TEP-1" (rebrand's is fresh —
  // not even in `projects` yet as an owner — plugin-delivery's is a real, unrelated,
  // already-promoted TEP-1). The caller is writing INTO rebrand, scoped directly.
  const projects = [
    { product: "Platform", id: "plugin-delivery", teps: ["1", "2", "3"] },
  ];
  const dest = resolveTepWritePath("1", projects, {
    product: "Platform",
    id: "rebrand",
  });
  assert.deepEqual(dest, { kind: "session" });
});

test("resolveTepWritePath: callerProject wins even when the caller's OWN project already owns the id (idempotent re-write)", () => {
  const projects = [
    { product: "Platform", id: "rebrand", teps: ["1"] },
    { product: "Platform", id: "plugin-delivery", teps: ["1", "2"] },
  ];
  const dest = resolveTepWritePath("1", projects, {
    product: "Platform",
    id: "rebrand",
  });
  assert.deepEqual(dest, { kind: "session" });
});

test("resolveTepWritePath: unscoped caller — no owner → session (fresh/repo-local TEP, unchanged)", () => {
  const dest = resolveTepWritePath("9", []);
  assert.deepEqual(dest, { kind: "session" });
});

test("resolveTepWritePath: unscoped caller — exactly one owner → redirected to that project's copy (unchanged)", () => {
  const projects = [
    { product: "Platform", id: "plugin-delivery", teps: ["1", "2"] },
  ];
  const dest = resolveTepWritePath("2", projects);
  assert.deepEqual(dest, {
    kind: "project",
    product: "Platform",
    projectId: "plugin-delivery",
    relativePath: "Platform/projects/plugin-delivery/teps/TEP-2/tep.md",
  });
});

test("resolveTepWritePath: unscoped caller — genuinely ambiguous (two projects both own it) → refuse, directs to thinking_space scoping OR promote_tep", () => {
  const projects = [
    { product: "Platform", id: "rebrand", teps: ["1"] },
    { product: "Platform", id: "plugin-delivery", teps: ["1"] },
  ];
  const dest = resolveTepWritePath("1", projects);
  assert.equal(dest.kind, "refuse");
  if (dest.kind !== "refuse") return;
  assert.deepEqual(dest.refuse.candidates, [
    "Platform/projects/rebrand",
    "Platform/projects/plugin-delivery",
  ]);
  assert.equal(dest.refuse.tool, PROMOTE_TOOL);
  // The message must not PRESUME a double-promotion mistake — it names the
  // project-scoping remedy first, since two independently-numbered projects
  // sharing a bare id is the NORMAL case, not necessarily an error.
  assert.match(dest.message, /thinking_space=/);
  assert.match(dest.message, /scoped per project/i);
  assert.match(dest.message, new RegExp(PROMOTE_TOOL));
});

// ── End-to-end reproduction of the LIVE bug, through the real registry ──────
// Two projects under one thinking space root, each holding its OWN "TEP-1"
// (independently minted, unrelated content). Writing into ONE of them, scoped by
// `thinking_space:`, must succeed — not be vetoed by the other project's TEP-1.

function twoProjectsEachWithTepOne(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-tep1-collision-"));
  const proj = (id: string, name: string) => {
    const dir = path.join(root, "Platform", "projects", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "project.yaml"), `name: ${name}\nstate: open\n`);
  };
  proj("plugin-delivery", "Plugin-first methodology delivery");
  const pdTep = path.join(root, "Platform", "projects", "plugin-delivery", "teps", "TEP-1");
  fs.mkdirSync(pdTep, { recursive: true });
  fs.writeFileSync(
    path.join(pdTep, "tep.md"),
    "---\nkind: tep\nid: TEP-1\nstatus: accepted\n---\n# Plugin-first methodology delivery\n",
  );
  // rebrand exists as a project (so `thinking_space: Platform/projects/rebrand`
  // resolves), but has NOT yet minted its own TEP-1 — this is the write under test.
  // `specs/` marks it thinking-space-shaped (real project enablement always
  // scaffolds it — see `isThinkingSpaceDir`); no `teps/` yet, deliberately.
  proj("rebrand", "The Rebrand");
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand", "specs"), {
    recursive: true,
  });
  return root;
}

test("REGRESSION: write_tep scoped to one project succeeds even though an UNRELATED project already has its own TEP-1", async () => {
  const root = twoProjectsEachWithTepOne();
  const reg = new ThinkingSpaceRegistry({
    thinkingSpaceRoot: root,
    folders: [],
    roots: [],
  } as never);
  const store = reg.resolve("Platform/projects/rebrand");
  const ctx = {
    env: { thinkingSpaceRoot: root } as never,
    thinkingSpaces: reg,
  };

  const res = (await writeTep(
    store,
    { tep: "1", title: "Component rebranding", body: "# TEP-1 — Component rebranding\n" },
    ctx as never,
  )) as { ok: boolean; tep: string; relativePath: string };

  assert.equal(res.ok, true);
  assert.equal(res.tep, "TEP-1");
  // Landed under rebrand's OWN teps/ (store-relative, since `store` IS already
  // rooted at the project dir — no product/projects/id prefix needed here, unlike
  // the cross-project REDIRECT case).
  assert.match(res.relativePath, /teps[\\/]TEP-1/);
  const written = fs.readFileSync(
    path.join(root, "Platform", "projects", "rebrand", "teps", "TEP-1", "tep.md"),
    "utf8",
  );
  assert.match(written, /Component rebranding/);
  // plugin-delivery's TEP-1 is completely untouched.
  const pd = fs.readFileSync(
    path.join(root, "Platform", "projects", "plugin-delivery", "teps", "TEP-1", "tep.md"),
    "utf8",
  );
  assert.match(pd, /Plugin-first methodology delivery/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("REGRESSION: the SAME reproduction through dispatchTool (write_tep tool call, not the bare function)", async () => {
  const root = twoProjectsEachWithTepOne();
  const reg = new ThinkingSpaceRegistry({
    thinkingSpaceRoot: root,
    folders: [],
    roots: [],
  } as never);
  const ctx = {
    env: { thinkingSpaceRoot: root } as never,
    thinkingSpaces: reg,
  };
  const ALLOW = () => {};

  const res = (await dispatchTool(
    "write_tep",
    {
      thinking_space: "Platform/projects/rebrand",
      tep: "1",
      title: "Component rebranding",
    },
    ctx as never,
    ALLOW,
  )) as { ok: boolean; tep: string };

  assert.equal(res.ok, true);
  assert.equal(res.tep, "TEP-1");

  fs.rmSync(root, { recursive: true, force: true });
});
