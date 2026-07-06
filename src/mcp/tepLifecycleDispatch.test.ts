/**
 * Handler-driven tests for the TEP-lifecycle gate (SP-th4wqg / SP-G of
 * TEP-th3i18). The ACs drive the REAL handlers through `dispatchTool` over a
 * `{ env: { thinkingSpaceRoot }, thinkingSpaces }` fixture that seeds a TEP + its implementing
 * Specs (cross-thinking space, resolved via `implementsRef`) — NOT the pure
 * `tepLifecycle` predicates in isolation (the auditor reframe). The three
 * groups match the spec's `ac_verifications` name-patterns:
 *
 *   - "approval"    (AC#1) — `create_slice` → Ready is refused while the parent
 *                            Spec's `implements:` TEP is not `accepted`.
 *   - "complete"    (AC#2) — `get_project` exposes completeness: not-complete
 *                            (naming the open Spec) while any implementing Spec
 *                            is unaccepted; complete once all are.
 *   - "implemented" (AC#3) — `write_tep status: implemented` is refused while a
 *                            Spec is unaccepted (names it); ok once all accepted.
 *
 * Refusals surface as a thrown `Error` (the server's refusal convention), so
 * they're asserted with `assert.rejects`. `installVscodeStub` is imported FIRST;
 * `main()` is `require.main`-guarded so importing the module doesn't boot stdio.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool, getProject } from "./kanbanMcpServer";
import { armApprovalForSlicing } from "./approvalGateTestSupport";

const ALLOW = () => {}; // writeGate: AI writes permitted.
const AC_BODY = "# Demo\n\n## Acceptance Criteria\n\n- [ ] x\n";

/** A single-thinking space fixture: a thinking space dir under a thinking space root holding one TEP (with
 *  `status`) and one Spec implementing it bare, certified for the → Ready gate. */
async function singleThinkingSpaceFixture(opts: {
  tepStatus: string;
  specAccepted?: boolean;
}): Promise<{ ctx: unknown; store: ThinkubeStore }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-teplc-"));
  const thinkingSpaceDir = path.join(root, "Platform", "core", "thinkube");
  fs.mkdirSync(thinkingSpaceDir, { recursive: true });
  const store = new ThinkubeStore(thinkingSpaceDir, thinkingSpaceDir);

  // Composite-id tree layout: TEP "1" and a Spec "1/1" implementing it bare.
  await store.writeFile(
    store.pathForTep("1"),
    {
      kind: "tep",
      id: "TEP-1",
      status: opts.tepStatus as "proposed" | "accepted",
    },
    "# Demo TEP\n",
  );
  await store.writeFile(
    store.pathForSpecDoc("1/1"),
    {
      implements: "TEP-1",
      ac_verifications: { "1": { run: "npm test" } },
      ...(opts.specAccepted ? { accepted: "2026-06-26T00:00:00.000Z" } : {}),
    },
    AC_BODY,
  );

  const ctx = {
    env: { thinkingSpaceRoot: root, allowAIWrites: true },
    thinkingSpaces: {
      list: () => [{ id: "A", worktree: false }],
      resolve: () => store,
    },
  };
  return { ctx, store };
}

// ── AC#1: approval gate ──────────────────────────────────────────────────────

test("approval: create_slice → Ready is refused while the implements: TEP is proposed", async () => {
  const { ctx, store } = await singleThinkingSpaceFixture({
    tepStatus: "proposed",
  });
  await armApprovalForSlicing(store, "1/1");
  await assert.rejects(
    () =>
      dispatchTool(
        "create_slice",
        {
          spec: "1/1",
          title: "a slice",
          body: "body",
          docs: "n/a",
          docs_reason: "test",
        },
        ctx as never,
        ALLOW,
      ),
    (err: Error) => {
      // The refusal names the TEP and its blocking status.
      assert.match(err.message, /TEP-1/);
      assert.match(err.message, /proposed/);
      return true;
    },
  );
});

test("approval: create_slice succeeds once the implements: TEP is accepted", async () => {
  const { ctx, store } = await singleThinkingSpaceFixture({
    tepStatus: "accepted",
  });
  await armApprovalForSlicing(store, "1/1");
  const res = (await dispatchTool(
    "create_slice",
    {
      spec: "1/1",
      title: "a slice",
      body: "body",
      docs: "n/a",
      docs_reason: "test",
    },
    ctx as never,
    ALLOW,
  )) as { slice: string };
  assert.match(res.slice, /^TEP-1_SP-1_SL-\d+$/);
});

// ── AC#2: completeness on get_project ────────────────────────────────────────

/** A thinking space root with a project owning an umbrella TEP, plus a member-Spec thinking space
 *  whose Spec implements that TEP (optionally accepted). */
async function projectFixture(specAccepted: boolean): Promise<unknown> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-teplc-proj-"));
  const projTeps = path.join(root, "Platform", "projects", "rebrand", "teps");
  // Umbrella TEP in the nested org-tree form `teps/TEP-reb/tep.md` (a project
  // uses the bare `teps/` root — see promote_tep / projectTeps).
  fs.mkdirSync(path.join(projTeps, "TEP-reb"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "Platform", "projects", "rebrand", "project.yaml"),
    "name: The Rebrand\nstate: open\n",
  );
  fs.writeFileSync(
    path.join(projTeps, "TEP-reb", "tep.md"),
    "---\nkind: tep\nid: TEP-reb\n---\n# Rebrand\n",
  );

  const memberDir = path.join(root, "Platform", "core", "thinkube");
  fs.mkdirSync(memberDir, { recursive: true });
  const member = new ThinkubeStore(memberDir, memberDir);
  // Composite-id tree layout: the member Spec is "1/1" (handle TEP-1_SP-1).
  await member.writeFile(
    member.pathForSpecDoc("1/1"),
    {
      implements: "Platform/projects/rebrand:TEP-reb",
      ...(specAccepted ? { accepted: "2026-06-26T00:00:00.000Z" } : {}),
    },
    AC_BODY,
  );

  return {
    env: { thinkingSpaceRoot: root },
    thinkingSpaces: {
      list: () => [{ id: "A", worktree: false }],
      resolve: () => member,
    },
  };
}

test("complete: get_project reports not-complete and names the open spec while a member is unaccepted", async () => {
  const ctx = await projectFixture(false);
  const res = (await getProject(ctx as never, "Platform", "rebrand")) as {
    complete: boolean;
    openSpecs: string[];
    completeness: { tep: string; complete: boolean; openSpecs: string[] }[];
  };
  assert.equal(res.complete, false);
  assert.deepEqual(res.openSpecs, ["TEP-1_SP-1"]);
  const reb = res.completeness.find((c) => c.tep === "TEP-reb");
  assert.equal(reb?.complete, false);
  assert.deepEqual(reb?.openSpecs, ["TEP-1_SP-1"]);
});

test("complete: get_project reports complete once every implementing spec is accepted", async () => {
  const ctx = await projectFixture(true);
  const res = (await getProject(ctx as never, "Platform", "rebrand")) as {
    complete: boolean;
    openSpecs: string[];
    completeness: { tep: string; complete: boolean }[];
  };
  assert.equal(res.complete, true);
  assert.deepEqual(res.openSpecs, []);
  assert.equal(
    res.completeness.find((c) => c.tep === "TEP-reb")?.complete,
    true,
  );
});

// ── AC#3: `implemented` terminal status, gated on completeness ────────────────

test("implemented: write_tep status:implemented is refused while a spec is unaccepted, naming it", async () => {
  const { ctx } = await singleThinkingSpaceFixture({
    tepStatus: "accepted",
    specAccepted: false,
  });
  await assert.rejects(
    () =>
      dispatchTool(
        "write_tep",
        { tep: "1", status: "implemented" },
        ctx as never,
        ALLOW,
      ),
    (err: Error) => {
      assert.match(err.message, /implemented/);
      // The open Spec is named by its tep-qualified handle (TEP-1_SP-1).
      assert.match(err.message, /TEP-1_SP-1/);
      return true;
    },
  );
});

test("implemented: write_tep status:implemented succeeds once every spec is accepted", async () => {
  const { ctx, store } = await singleThinkingSpaceFixture({
    tepStatus: "accepted",
    specAccepted: true,
  });
  const res = (await dispatchTool(
    "write_tep",
    { tep: "1", status: "implemented" },
    ctx as never,
    ALLOW,
  )) as { tep: string };
  assert.equal(res.tep, "TEP-1");
  // The terminal status was actually persisted.
  const fm = (await store.getFile(store.pathForTep("1")))?.frontmatter;
  assert.equal(fm?.status, "implemented");
});
