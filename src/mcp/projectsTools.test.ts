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
import { projectTeps } from "../store/projects";
import {
  listProjects,
  getProject,
  resolveProjectSpace,
  createSlice,
  promoteTep,
} from "./kanbanMcpServer";
import { armApprovalForSlicing } from "./approvalGateTestSupport";

/** A tmp thinking space root with two products; the `rebrand` project owns an umbrella TEP. */
function thinkingSpaceRootWithProjects(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projbr-"));
  const proj = (rel: string, yaml: string) => {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, "project.yaml"), yaml);
  };
  proj("Platform/projects/rebrand", "name: The Rebrand\nstate: open\n");
  // The umbrella TEP the project owns — nested org-tree form `teps/TEP-reb/tep.md`.
  fs.mkdirSync(
    path.join(root, "Platform", "projects", "rebrand", "teps", "TEP-reb"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(
      root,
      "Platform",
      "projects",
      "rebrand",
      "teps",
      "TEP-reb",
      "tep.md",
    ),
    "---\nkind: tep\nid: TEP-reb\n---\n# Rebrand\n",
  );
  proj("Apps/projects/search", "name: Search\n");
  return root;
}

/**
 * A tmp thinking space store with one Spec (given `implements`) that has acceptance
 * criteria. `spec` is the org-scoped composite `<tep>/<spec>` (numeric, so the
 * slice handle/path regexes resolve).
 */
async function seededStore(
  spec: string,
  implementsRef: string,
): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projstore-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    {
      implements: implementsRef,
      ac_verifications: { "1": { run: "npm test" } },
    },
    "# Demo\n\n## Acceptance Criteria\n\n- [ ] x\n",
  );
  return store;
}

test("list_projects returns every product's projects, sorted", () => {
  const res = listProjects({
    env: { thinkingSpaceRoot: thinkingSpaceRootWithProjects() },
  } as never) as { projects: { product: string; id: string }[] };
  assert.deepEqual(
    res.projects.map((p) => `${p.product}/${p.id}`),
    ["Apps/search", "Platform/rebrand"],
  );
});

test("get_project members = specs implementing the umbrella TEP + their slices (not tags)", async () => {
  const root = thinkingSpaceRootWithProjects();
  // member: implements the project's umbrella TEP via the qualified ref. Its
  // own org-tree home is TEP-1/SP-1 (where the file sits), independent of the
  // logical `implements:` link to the umbrella TEP-reb.
  const a = await seededStore("1/1", "Platform/projects/rebrand:TEP-reb");
  // non-member: implements something else.
  const b = await seededStore("2/1", "Apps/projects/other:TEP-zzz");
  await armApprovalForSlicing(a, "1/1");
  const sl = (await createSlice(a, {
    spec: "1/1",
    title: "a member slice",
    body: "d",
  })) as { slice: string };

  const ctx = {
    env: { thinkingSpaceRoot: root },
    thinkingSpaces: {
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
  // the implementing spec (tep-qualified handle) + its (inherited) slice; the
  // non-member excluded.
  assert.deepEqual(handles, ["TEP-1_SP-1", sl.slice].sort());
  assert.ok(!handles.includes("TEP-2_SP-1"));
});

test("get_project surfaces a NESTED member spec: thinking_space = umbrella (file location), repo = working repo", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-proj-nested-"));
  const projDir = path.join(root, "Platform", "projects", "rebrand");
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, "project.yaml"), "name: Rebrand\n");
  // The umbrella TEP-1 and its member spec live NESTED under the project (where
  // promote_tep relocated them); the member carries `repo:` = its working repo.
  const projStore = new ThinkubeStore(projDir, projDir);
  await projStore.writeFile(
    projStore.pathForTep("1"),
    { kind: "tep", id: "TEP-1" },
    "# umbrella\n",
  );
  await projStore.writeFile(
    projStore.pathForSpecDoc("1/1"),
    { repo: "Platform/extensions/thinkube-ai-integration" },
    "# member\n\n## Acceptance Criteria\n\n- [ ] x\n",
  );

  const ctx = {
    env: { thinkingSpaceRoot: root },
    thinkingSpaces: { list: () => [], resolve: () => undefined },
  };
  const res = (await getProject(ctx as never, "Platform", "rebrand")) as {
    members: {
      thinking_space: string;
      repo: string;
      handle: string;
      kind: string;
    }[];
  };
  // The nested member is found location-based. `thinking_space` is WHERE THE FILE
  // LIVES — the project umbrella — so get_thinkube_file/write_spec target it; `repo`
  // (from repo:) is the working repo the orchestrator branches a worktree in.
  const member = res.members.find((m) => m.handle === "TEP-1_SP-1");
  assert.ok(member, "the nested member spec must be surfaced");
  assert.equal(member?.thinking_space, "Platform/projects/rebrand");
  assert.equal(member?.repo, "Platform/extensions/thinkube-ai-integration");
});

test("resolve_project_space derives the umbrella namespace from a cwd under it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-resolve-"));
  const projDir = path.join(root, "Platform", "projects", "plugin-delivery");
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, "project.yaml"), "name: Delivery\n");
  const ctx = { env: { thinkingSpaceRoot: root } };

  // cwd IS the umbrella dir.
  assert.deepEqual(resolveProjectSpace(ctx as never, projDir), {
    namespace: "Platform/projects/plugin-delivery",
    project: { product: "Platform", id: "plugin-delivery" },
  });
  // cwd is a DESCENDANT of the umbrella dir.
  assert.equal(
    (
      resolveProjectSpace(ctx as never, path.join(projDir, "sub", "dir")) as {
        namespace: string;
      }
    ).namespace,
    "Platform/projects/plugin-delivery",
  );
});

test("resolve_project_space returns null when cwd is under no project umbrella", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-resolve-null-"));
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "project.yaml"),
    "name: Rebrand\n",
  );
  const ctx = { env: { thinkingSpaceRoot: root } };
  // A working-repo path, not under any umbrella.
  const res = resolveProjectSpace(
    ctx as never,
    "/home/thinkube/thinkube-platform/extensions/thinkube-ai-integration",
  ) as { namespace: null; reason: string };
  assert.equal(res.namespace, null);
  assert.equal(res.reason, "cwd-not-under-project-umbrella");
});

test("resolve_project_space rejects a non-absolute cwd and a missing root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-resolve-guard-"));
  assert.equal(
    (
      resolveProjectSpace(
        { env: { thinkingSpaceRoot: root } } as never,
        "rel/path",
      ) as {
        namespace: null;
        reason: string;
      }
    ).reason,
    "cwd-not-absolute",
  );
  assert.equal(
    (
      resolveProjectSpace({ env: {} } as never, "/abs/path") as {
        namespace: null;
        reason: string;
      }
    ).reason,
    "no-thinking-space-root",
  );
});

test("promote_tep moves the TEP and rewrites EVERY dependent (SP-tgvpbm_SL-3)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-"));
  // The target project exists (empty teps/).
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "project.yaml"),
    "name: Rebrand\n",
  );
  const mk = (ns: string) => {
    const bd = path.join(root, ...ns.split("/"));
    fs.mkdirSync(bd, { recursive: true });
    return new ThinkubeStore(bd, bd);
  };
  const origin = mk("Platform/core/thinkube");
  const control = mk("Platform/core/control");
  const ac = "## Acceptance Criteria\n\n- [ ] x\n";

  // TEP-reb lives in the origin repo thinking space as the nested org-tree dir
  // `teps/TEP-reb/tep.md` (via the store) — a TEP IS its directory (tep.md + its
  // SP-m specs), and promote_tep moves that whole dir into the project.
  await origin.writeFile(
    origin.pathForTep("reb"),
    { kind: "tep", id: "TEP-reb" },
    "# Reb\n",
  );
  // SP-a (origin) implements TEP-reb bare; SP-b (other repo) implements it
  // qualified to origin; SP-c implements something else (non-dependent). The spec
  // ids are org-scoped composites `<tep>/<spec>` (numeric) — distinct per thinking space so
  // their tep-qualified handles don't collide.
  await origin.writeFile(
    origin.pathForSpecDoc("1/1"),
    { implements: "TEP-reb" },
    `# A\n\n${ac}`,
  );
  await control.writeFile(
    control.pathForSpecDoc("2/1"),
    { implements: "Platform/core/thinkube:TEP-reb" },
    `# B\n\n${ac}`,
  );
  await control.writeFile(
    control.pathForSpecDoc("3/1"),
    { implements: "TEP-other" },
    `# C\n\n${ac}`,
  );

  const ctx = {
    env: { thinkingSpaceRoot: root },
    thinkingSpaces: {
      list: () => [
        { id: "O", worktree: false },
        { id: "C", worktree: false },
      ],
      resolve: (id: string) => (id === "O" ? origin : control),
    },
  };
  const res = (await promoteTep(
    ctx as never,
    "reb",
    "Platform",
    "rebrand",
  )) as {
    tep: string;
    fromTep: string;
    rewritten: string[];
  };

  // RE-ID'd into the project's scope: the empty project's next number is 1, so
  // TEP-reb becomes TEP-1 there. (The number is unique only within a thinking space+org
  // scope — preserving "reb"/a colliding number would clash with the project.)
  assert.equal(res.tep, "TEP-1");
  assert.equal(res.fromTep, "TEP-reb");
  // moved as the nested dir under the project; gone from the origin repo, and the
  // moved tep.md's own frontmatter id is re-stamped to the new number.
  assert.ok(
    fs.existsSync(
      path.join(
        root,
        "Platform",
        "projects",
        "rebrand",
        "teps",
        "TEP-1",
        "tep.md",
      ),
    ),
  );
  assert.ok(
    !fs.existsSync(
      path.join(root, "Platform", "core", "thinkube", "teps", "TEP-reb"),
    ),
  );
  const moved = await new ThinkubeStore(
    path.join(root, "Platform", "projects", "rebrand"),
    path.join(root, "Platform", "projects", "rebrand"),
  ).getFile(path.join("teps", "TEP-1", "tep.md"));
  assert.equal(moved?.frontmatter?.id, "TEP-1");
  // EVERY dependent rewritten to the qualified umbrella ref at the NEW id; none
  // dangling. The rewritten handles are the dependents' tep-qualified spec handles.
  assert.deepEqual(res.rewritten.sort(), ["TEP-1_SP-1", "TEP-2_SP-1"]);
  const want = "Platform/projects/rebrand:TEP-1";
  assert.equal(
    (await origin.getFile(origin.pathForSpecDoc("1/1")))?.frontmatter
      ?.implements,
    want,
  );
  assert.equal(
    (await control.getFile(control.pathForSpecDoc("2/1")))?.frontmatter
      ?.implements,
    want,
  );
  // non-dependent untouched
  assert.equal(
    (await control.getFile(control.pathForSpecDoc("3/1")))?.frontmatter
      ?.implements,
    "TEP-other",
  );
});

test("promote_tep re-ids to avoid a collision with the project's existing TEP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-clash-"));
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "project.yaml"),
    "name: Rebrand\n",
  );
  // The project ALREADY owns a TEP-1 (nested). The incoming TEP also numbered 1
  // on its origin thinking space — the classic collision the sequential scheme creates.
  fs.mkdirSync(
    path.join(root, "Platform", "projects", "rebrand", "teps", "TEP-1"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(
      root,
      "Platform",
      "projects",
      "rebrand",
      "teps",
      "TEP-1",
      "tep.md",
    ),
    "---\nkind: tep\nid: TEP-1\n---\n# the project's own TEP-1\n",
  );

  const origin = new ThinkubeStore(
    (() => {
      const bd = path.join(root, "Platform", "core", "thinkube");
      fs.mkdirSync(bd, { recursive: true });
      return bd;
    })(),
    path.join(root, "Platform", "core", "thinkube"),
  );
  await origin.writeFile(
    origin.pathForTep("1"),
    { kind: "tep", id: "TEP-1" },
    "# incoming\n",
  );

  const ctx = {
    env: { thinkingSpaceRoot: root },
    thinkingSpaces: {
      list: () => [{ id: "O", worktree: false }],
      resolve: () => origin,
    },
  };
  const res = (await promoteTep(ctx as never, "1", "Platform", "rebrand")) as {
    tep: string;
  };

  // Re-allocated to TEP-2 (max existing + 1) — NOT overwriting the project's TEP-1.
  assert.equal(res.tep, "TEP-2");
  assert.equal(
    (
      await new ThinkubeStore(
        path.join(root, "Platform", "projects", "rebrand"),
        path.join(root, "Platform", "projects", "rebrand"),
      ).getFile(path.join("teps", "TEP-1", "tep.md"))
    )?.body.trim(),
    "# the project's own TEP-1", // untouched
  );
  assert.ok(
    fs.existsSync(
      path.join(
        root,
        "Platform",
        "projects",
        "rebrand",
        "teps",
        "TEP-2",
        "tep.md",
      ),
    ),
  );
});

test("promote_tep places the TEP under the project's existing <org>/teps root", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-org-"));
  fs.mkdirSync(path.join(root, "Platform", "projects", "rebrand"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "project.yaml"),
    "name: Rebrand\n",
  );
  // The project's existing TEPs live under an `<org>/teps` segment (migrated
  // project) — the promoted TEP must land THERE, not at a sibling bare `teps/`
  // the org-aware projectTeps would never read.
  fs.mkdirSync(
    path.join(
      root,
      "Platform",
      "projects",
      "rebrand",
      "cmxela",
      "teps",
      "TEP-1",
    ),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(
      root,
      "Platform",
      "projects",
      "rebrand",
      "cmxela",
      "teps",
      "TEP-1",
      "tep.md",
    ),
    "---\nkind: tep\nid: TEP-1\n---\n# existing\n",
  );

  const originDir = path.join(root, "Platform", "core", "thinkube");
  fs.mkdirSync(originDir, { recursive: true });
  const origin = new ThinkubeStore(originDir, originDir);
  await origin.writeFile(
    origin.pathForTep("9"),
    { kind: "tep", id: "TEP-9" },
    "# incoming\n",
  );

  const ctx = {
    env: { thinkingSpaceRoot: root },
    thinkingSpaces: {
      list: () => [{ id: "O", worktree: false }],
      resolve: () => origin,
    },
  };
  const res = (await promoteTep(ctx as never, "9", "Platform", "rebrand")) as {
    tep: string;
  };

  // Re-id'd to TEP-2 (next after the existing TEP-1) AND placed under cmxela/teps,
  // so projectTeps/get_project can see it.
  assert.equal(res.tep, "TEP-2");
  assert.ok(
    fs.existsSync(
      path.join(
        root,
        "Platform",
        "projects",
        "rebrand",
        "cmxela",
        "teps",
        "TEP-2",
        "tep.md",
      ),
    ),
    "promoted TEP must land under the project's <org>/teps root",
  );
  assert.deepEqual(
    projectTeps(root, "Platform", "rebrand").sort(),
    ["1", "2"],
    "projectTeps must enumerate both the existing and the promoted TEP",
  );
});

test("promote_tep refuses when the target project does not exist", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-no-"));
  await assert.rejects(
    promoteTep(
      {
        env: { thinkingSpaceRoot: root },
        thinkingSpaces: { list: () => [], resolve: () => undefined },
      } as never,
      "reb",
      "Platform",
      "nope",
    ),
  );
});

test("get_project throws for an unknown project", async () => {
  await assert.rejects(
    getProject(
      {
        env: { thinkingSpaceRoot: thinkingSpaceRootWithProjects() },
        thinkingSpaces: { list: () => [], resolve: () => undefined },
      } as never,
      "Platform",
      "nope",
    ),
  );
});
