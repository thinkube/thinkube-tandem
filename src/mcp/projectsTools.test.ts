/**
 * Handler tests for list_projects / get_project (SP-tgvkmt_SL-2). installVscodeStub
 * pattern (stub imported FIRST); main() is require.main-guarded so importing the
 * server module doesn't boot the stdio server.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { listProjects, getProject, createSlice } from "./kanbanMcpServer";

/** A tmp board root carrying two products, each with a project.yaml. */
function boardRootWithProjects(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projbr-"));
  const proj = (rel: string, yaml: string) => {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, "project.yaml"), yaml);
  };
  proj("Platform/projects/rebrand", "name: The Rebrand\nstate: open\ntag: rebrand\n");
  proj("Apps/projects/search", "tag: search\n");
  return root;
}

/** A tmp board store seeded with a Spec that has acceptance criteria. */
async function seededStore(spec: string): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projstore-"));
  const store = new ThinkubeStore(board, board);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x" },
    "# Demo\n\n## Acceptance Criteria\n\n- [ ] x\n",
  );
  return store;
}

test("list_projects returns every product's projects, sorted", () => {
  const res = listProjects({
    env: { boardRoot: boardRootWithProjects() },
  } as never) as { projects: { product: string; id: string }[] };
  assert.deepEqual(
    res.projects.map((p) => `${p.product}/${p.id}`),
    ["Apps/search", "Platform/rebrand"],
  );
});

test("get_project returns the manifest + tag-resolved members (non-matching excluded)", async () => {
  const root = boardRootWithProjects();
  const a = await seededStore("aaa");
  const b = await seededStore("bbb");
  const member = (await createSlice(a, {
    spec: "aaa",
    title: "a member",
    body: "d",
    tags: ["rebrand"],
  })) as { slice: string };
  await createSlice(b, {
    spec: "bbb",
    title: "not a member",
    body: "d",
    tags: ["other"],
  });

  const ctx = {
    env: { boardRoot: root },
    boards: {
      list: () => [
        { id: "A", worktree: false },
        { id: "B", worktree: false },
      ],
      resolve: (id: string) => (id === "A" ? a : b),
    },
  };
  const res = (await getProject(ctx as never, "Platform", "rebrand")) as {
    project: { id: string; tag: string };
    members: { handle: string }[];
  };
  assert.equal(res.project.id, "rebrand");
  assert.equal(res.project.tag, "rebrand");
  assert.deepEqual(
    res.members.map((m) => m.handle),
    [member.slice],
  );
});

test("get_project throws for an unknown project", async () => {
  await assert.rejects(
    getProject(
      {
        env: { boardRoot: boardRootWithProjects() },
        boards: { list: () => [], resolve: () => undefined },
      } as never,
      "Platform",
      "nope",
    ),
  );
});
