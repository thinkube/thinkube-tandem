/**
 * Handler tests for list_projects / get_project (SP-tgvkmt_SL-2, reworked for
 * the structural-umbrella model in SP-tgvpbm_SL-2). installVscodeStub pattern
 * (stub imported FIRST); main() is require.main-guarded.
 *
 * Membership is now structural: a project's members are the specs whose
 * `implements:` resolves to one of the project's umbrella TEPs, plus their slices.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { listProjects, getProject, createSlice } from "./kanbanMcpServer";

/** A tmp board root with two products; the `rebrand` project owns an umbrella TEP. */
function boardRootWithProjects(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projbr-"));
  const proj = (rel: string, yaml: string) => {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, "project.yaml"), yaml);
  };
  proj("Platform/projects/rebrand", "name: The Rebrand\nstate: open\n");
  // The umbrella TEP the project owns.
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand", "teps"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "teps", "TEP-reb.md"),
    "---\nkind: tep\nid: TEP-reb\n---\n# Rebrand\n",
  );
  proj("Apps/projects/search", "name: Search\n");
  return root;
}

/** A tmp board store with one Spec (given `implements`) that has acceptance criteria. */
async function seededStore(spec: string, implementsRef: string): Promise<ThinkubeStore> {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projstore-"));
  const store = new ThinkubeStore(board, board);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: implementsRef },
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

test("get_project members = specs implementing the umbrella TEP + their slices (not tags)", async () => {
  const root = boardRootWithProjects();
  // member: implements the project's umbrella TEP via the qualified ref.
  const a = await seededStore("aaa", "Platform/projects/rebrand:TEP-reb");
  // non-member: implements something else.
  const b = await seededStore("bbb", "Apps/projects/other:TEP-zzz");
  const sl = (await createSlice(a, {
    spec: "aaa",
    title: "a member slice",
    body: "d",
  })) as { slice: string };

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
    teps: string[];
    members: { handle: string; kind: string }[];
  };
  assert.deepEqual(res.teps, ["TEP-reb"]);
  const handles = res.members.map((m) => m.handle).sort();
  // the implementing spec + its (inherited) slice; the non-member excluded
  assert.deepEqual(handles, ["SP-aaa", sl.slice].sort());
  assert.ok(!handles.includes("SP-bbb"));
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
