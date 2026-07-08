/**
 * SP-6/20 (TEP-6) AC1 — `open_review` self-locates its control dir; no env var.
 *
 * Finishes SP-6/17's structural-arming story for the CONTROL-request half. The
 * `open_review` tool used to read `process.env.THINKUBE_CONTROL_DIR` and refuse
 * ("env not set") when it was absent — so any session spawned from a project-scope
 * `.mcp.json` (which by design carries no machine-local dirs) could never open a
 * review panel. This spec derives the dir lexically instead:
 *
 *     resolveControlDir(argv[1]) === path.join(resolveApprovalDir(argv[1]), "control")
 *     <gs>/<link>/dist/mcp/kanbanMcpServer.js  ->  <gs>/control
 *
 * This probe drives the two seams the SPEC CONTRACT pins, and NOTHING else:
 *   1. the exported pure resolver `resolveControlDir(invocationPath)` — proven to
 *      equal `<gs>/control` with `THINKUBE_CONTROL_DIR` deleted from the env, so
 *      the derivation is invocation-path arithmetic, never an env read; and
 *   2. the real `open_review` TOOL CALL via the exported `dispatchTool` (the layer
 *      the live MCP server runs), rooting `process.argv[1]` at an install-shaped
 *      path under a fresh temp globalStorage (the SP-6/17 `withArmedGate` idiom).
 *      With the env var ABSENT the call must SUCCEED — no "env not set" refusal —
 *      create `<gs>/control`, and write the `open-review-<hex(subjectKey)>.json`
 *      request file there, with the success result's `request` field carrying that
 *      file's absolute path.
 *
 * It exercises only the public interface (`resolveControlDir`, `dispatchTool`) and a
 * seeded temp `ThinkubeStore` — it makes no assumption about the internal write flow.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool, resolveControlDir } from "../mcp/kanbanMcpServer";

// The composite `<tep>/<spec>` id, the canonical id `open_review` accepts, and the
// kind-namespaced subject the request filename hashes (`spec:TEP-<t>/SP-<n>`).
const SPEC = "1/1";
const REVIEW_ID = "TEP-1/SP-1";
const SUBJECT_KEY = "spec:TEP-1/SP-1";
const CONTROL_DIR_ENV = "THINKUBE_CONTROL_DIR";

/** A fresh thinking space seeded with the spec doc `open_review` requires to exist
 *  before it will mount a review panel (kind === "spec" checks `getFile(docRel)`). */
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-control-dir-thinking-space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-1" },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

const openReview = (store: ThinkubeStore) =>
  dispatchTool(
    "open_review",
    { kind: "spec", id: REVIEW_ID },
    ctxFor(store),
    () => {},
  );

/**
 * Run `fn` with `process.argv[1]` rooted at an install-shaped path under a fresh temp
 * globalStorage dir (`<gs>/extension-current/dist/mcp/kanbanMcpServer.js`), whose
 * three-up walk lands on `<gs>`, so the control dir self-locates to `<gs>/control`.
 * `THINKUBE_CONTROL_DIR` is DELETED from the env for the duration (and restored after)
 * to prove the derivation never consults it. argv[1] is restored so tests can't
 * cross-pollute.
 */
async function withArmedControlDir(
  fn: (gs: string) => Promise<void>,
): Promise<void> {
  const gs = fs.mkdtempSync(path.join(os.tmpdir(), "tk-globalstorage-"));
  const prevArgv = process.argv[1];
  const prevEnv = process.env[CONTROL_DIR_ENV];
  delete process.env[CONTROL_DIR_ENV];
  process.argv[1] = path.join(
    gs,
    "extension-current",
    "dist",
    "mcp",
    "kanbanMcpServer.js",
  );
  try {
    await fn(gs);
  } finally {
    process.argv[1] = prevArgv;
    if (prevEnv === undefined) delete process.env[CONTROL_DIR_ENV];
    else process.env[CONTROL_DIR_ENV] = prevEnv;
  }
}

// ── the pure resolver: <gs>/<link>/dist/mcp/kanbanMcpServer.js -> <gs>/control ──

test("resolveControlDir derives <gs>/control lexically from the install-shaped invocation path, with THINKUBE_CONTROL_DIR absent", () => {
  const prevEnv = process.env[CONTROL_DIR_ENV];
  delete process.env[CONTROL_DIR_ENV];
  try {
    const gs = path.join(
      "/home/thinkube/.config/Code/User/globalStorage",
      "thinkube.thinkube-ai-integration",
    );
    const invocation = path.join(
      gs,
      "extension-current",
      "dist",
      "mcp",
      "kanbanMcpServer.js",
    );
    assert.equal(resolveControlDir(invocation), path.join(gs, "control"));
  } finally {
    if (prevEnv === undefined) delete process.env[CONTROL_DIR_ENV];
    else process.env[CONTROL_DIR_ENV] = prevEnv;
  }
});

// ── AC1 core: env absent + install-shaped argv → open_review SUCCEEDS + writes ──

test("AC1 — with THINKUBE_CONTROL_DIR deleted, open_review self-locates <gs>/control, writes the request file there, and returns its absolute path (no 'env not set' refusal)", async () => {
  await withArmedControlDir(async (gs) => {
    // The seam under test resolves to exactly the same dir the tool must write into.
    const controlDir = resolveControlDir(process.argv[1]);
    assert.equal(
      controlDir,
      path.join(gs, "control"),
      "resolveControlDir(argv[1]) must be <gs>/control",
    );

    const store = await seededStore();

    // With the env var ABSENT, the call must NOT reject with an 'env not set'
    // refusal — it resolves the dir structurally and completes the write.
    const res = (await openReview(store)) as {
      ok: boolean;
      subjectKey: string;
      request: string;
    };

    assert.equal(res.ok, true);
    assert.equal(res.subjectKey, SUBJECT_KEY);

    // `request` carries the ABSOLUTE path of the written file, located under
    // <gs>/control (a probe asserts the location without recomputing the name).
    assert.ok(
      path.isAbsolute(res.request),
      `the result's request field must be an absolute path (got: ${res.request})`,
    );
    assert.equal(
      path.dirname(res.request),
      controlDir,
      "the request file must live under the self-located <gs>/control dir",
    );

    // Filename is the pinned `open-review-<hex(subjectKey)>.json`.
    const expectedName = `open-review-${Buffer.from(SUBJECT_KEY, "utf8").toString("hex")}.json`;
    assert.equal(path.basename(res.request), expectedName);

    // The directory was created if missing and the request JSON was actually written.
    assert.ok(
      fs.existsSync(res.request),
      "the open-review request file must exist on disk at the returned path",
    );
    const written = JSON.parse(fs.readFileSync(res.request, "utf8")) as {
      kind: string;
      subjectKind: string;
      subjectKey: string;
    };
    assert.equal(written.kind, "open-review");
    assert.equal(written.subjectKind, "spec");
    assert.equal(written.subjectKey, SUBJECT_KEY);
  });
});

// ── the refusal is gone: no error mentions the retired env var ────────────────
// Guards against a regression that keeps a fallback env read whose absence still
// throws — the whole point of the spec is that the env var no longer gates the tool.

test("AC1 — open_review never surfaces an 'env not set' / THINKUBE_CONTROL_DIR refusal when the env var is absent", async () => {
  await withArmedControlDir(async () => {
    const store = await seededStore();
    // A throw here would fail the test outright; the assertion documents intent —
    // the only remaining failure modes are real I/O errors, not a missing env var.
    const res = (await openReview(store)) as { ok: boolean };
    assert.equal(res.ok, true);
    assert.equal(
      process.env[CONTROL_DIR_ENV],
      undefined,
      "the env var stayed deleted — the success did not depend on it",
    );
  });
});
