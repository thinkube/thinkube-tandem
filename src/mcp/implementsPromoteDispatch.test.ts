/**
 * AC#3 (SP-th4wqe_SL-3 / issue #3): the cross-thinking space promote guard must fire on
 * the REAL seam — a `write_spec` TOOL CALL through `dispatchTool`, the layer the
 * live MCP server actually runs — not on the pure `implementsPromoteCheck`
 * classifier in isolation. This test drives `dispatchTool("write_spec", …)` with
 * an **injected fake locator** and asserts the three cases the spec calls out:
 *
 *   - a qualified `<namespace>:TEP-<id>` ref the locator reports **unpromoted**
 *     (`false`) → the call is **refused** with a message naming `promote_tep`,
 *     and the dangling cross-thinking space `implements:` is NOT persisted;
 *   - the same qualified ref the locator reports **promoted** (`true`) → accepted
 *     and the `implements:` is written;
 *   - a **bare** repo-local `TEP-<id>` ref → accepted WITHOUT consulting the
 *     locator (nothing cross-thinking space to promote).
 *
 * ── Injection seam (the contract the wiring in `kanbanMcpServer.ts` honours) ──
 * The fake locator is injected via `ctx.promoteLocator` — the same optional-on-
 * `HandlerContext` idiom as `ctx.lock` (#20). `dispatchTool`'s `write_spec` case
 * runs `implementsPromoteCheck(args.implements, ctx.promoteLocator ?? <thinking space-
 * backed default>)` before `writeSpec`; on `{ ok: false }` it throws the
 * result's `message` (which names `promote_tep`). Refusals surface as a thrown
 * `Error` — the server's refusal convention (cf. `promote_tep` / `get_project`),
 * so they're asserted with `assert.rejects`.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";
import type { PromoteLocator } from "../methodology/implementsPromoteCheck";

/** A thinking space with one existing spec doc (so `write_spec` is an update, and we can
 *  read back the persisted — or refused — frontmatter). */
async function seededStore(spec: string): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-promote-dispatch-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    {},
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

/** Minimal `HandlerContext` for a `write_spec` dispatch + the injected locator.
 *  Declared as a `const` (not an inline literal) so the extra `promoteLocator`
 *  field is not rejected by excess-property checks. */
function ctxWith(store: ThinkubeStore, promoteLocator: PromoteLocator) {
  return {
    env: {} as never,
    thinkingSpaces: { resolve: () => store } as never,
    promoteLocator,
  };
}

const ALLOW = () => {}; // writeGate: AI writes permitted.

// NOTE (2026-07-11 ref grammar): `spec: "7"` is a BARE id — write_spec now
// composes it with the parent TEP from `implements:` (`abc/7`, `local1/7`)
// instead of letting a raw pass-through build a phantom
// `SP-undefined` path (which these fixtures previously round-tripped
// through). Seeds and read-backs therefore use the composed composite id.

test("write_spec refuses an unpromoted cross-thinking space implements, naming promote_tep", async () => {
  const store = await seededStore("abc/7");
  const calls: { namespace?: string; id: string }[] = [];
  const locator: PromoteLocator = (ref) => {
    calls.push({ namespace: ref.namespace, id: ref.id });
    return false; // unpromoted / dangling
  };

  await assert.rejects(
    () =>
      dispatchTool(
        "write_spec",
        {
          spec: "7",
          body: "# Demo Spec\n\nupdated body\n",
          implements: "acme/widgets:TEP-abc",
        },
        ctxWith(store, locator),
        ALLOW,
      ),
    /promote_tep/,
    "an unpromoted qualified ref must be refused with a message naming promote_tep",
  );

  // The qualified ref was the one consulted (split on the last `:`).
  assert.equal(calls.length, 1, "the locator is consulted exactly once");
  assert.equal(calls[0].namespace, "acme/widgets");
  assert.equal(calls[0].id, "abc");

  // A refusal must not persist the dangling cross-thinking space link.
  const parsed = await store.getFile(store.pathForSpecDoc("abc/7"));
  assert.notEqual(
    parsed?.frontmatter?.implements,
    "acme/widgets:TEP-abc",
    "the refused cross-thinking space implements must not be written",
  );
});

test("write_spec accepts a promoted cross-thinking space implements", async () => {
  const store = await seededStore("abc/7");
  const locator: PromoteLocator = () => true; // promoted / reachable

  await dispatchTool(
    "write_spec",
    {
      spec: "7",
      body: "# Demo Spec\n\nupdated body\n",
      implements: "acme/widgets:TEP-abc",
    },
    ctxWith(store, locator),
    ALLOW,
  );

  const parsed = await store.getFile(store.pathForSpecDoc("abc/7"));
  assert.equal(
    parsed?.frontmatter?.implements,
    "acme/widgets:TEP-abc",
    "a promoted qualified ref is accepted and persisted",
  );
});

test("write_spec accepts a bare repo-local implements without consulting the locator", async () => {
  const store = await seededStore("local1/7");
  let consulted = false;
  const locator: PromoteLocator = () => {
    consulted = true;
    return false;
  };

  await dispatchTool(
    "write_spec",
    {
      spec: "7",
      body: "# Demo Spec\n\nupdated body\n",
      implements: "TEP-local1",
    },
    ctxWith(store, locator),
    ALLOW,
  );

  assert.equal(
    consulted,
    false,
    "a bare ref is repo-local — the cross-thinking space locator must not be consulted",
  );
  const parsed = await store.getFile(store.pathForSpecDoc("local1/7"));
  assert.equal(
    parsed?.frontmatter?.implements,
    "TEP-local1",
    "a bare repo-local ref is accepted and persisted",
  );
});
