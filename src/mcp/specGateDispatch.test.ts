/**
 * SP-th4wqf AC2 — the **structural** spec gate, driven through the real
 * `write_spec` TOOL CALL (i.e. `dispatchTool`, the layer the live MCP server
 * actually runs), not the pure predicate in isolation.
 *
 * What this proves: `write_spec` refuses a body missing any of the four
 * canonical sections (Acceptance Criteria / Constraints / Design / File
 * Structure Plan), naming the missing one; a body carrying all four is
 * accepted and written. The wiring under test lives in
 * `kanbanMcpServer.writeSpec`, which calls `specSectionsPresent` from
 * `../methodology/specStructure`.
 *
 * This test CONSUMES `specStructure` rather than re-deriving the section list:
 * the canonical names come from the exported `CANONICAL_SECTIONS`, so the test
 * can never drift from the gate's own source of truth for what's required.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";
import { CANONICAL_SECTIONS } from "../methodology/specStructure";
import { armApprovalForSlicing } from "./approvalGateTestSupport";

// ── tmp-store scaffolding (mirrors workUnitsDispatch.test.ts) ────────────────
// A fresh thinking space; `write_spec` creates the spec doc itself, so no seeding needed.
function freshStore(): ThinkubeStore {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-sections-thinking space-"),
  );
  return new ThinkubeStore(thinkingSpace, thinkingSpace);
}

// Minimal HandlerContext for `write_spec`: it touches ctx.thinkingSpaces.resolve and the
// promote locator. A bare/absent `implements:` never consults the locator, but
// the locator is constructed eagerly, so supply a no-op to stay self-contained.
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
  promoteLocator: (() => undefined) as never,
});

// The spec id is the composite `<tep>/<spec>` in the org-scoped tree layout.
const SPEC = "1/1";
const writeSpec = (store: ThinkubeStore, body: string) =>
  dispatchTool("write_spec", { spec: SPEC, body }, ctxFor(store), () => {});

/** A spec body containing exactly the given canonical sections, each as a `##` heading. */
function bodyWith(sections: ReadonlyArray<string>): string {
  const parts = ["# Demo Spec", ""];
  for (const s of sections) {
    parts.push(`## ${s}`, "", `placeholder for ${s}`, "");
  }
  return parts.join("\n");
}

// ── refused: a body missing any one canonical section names that section ─────
// Parametrized over CANONICAL_SECTIONS so each of the four is proven load-bearing.
for (const missing of CANONICAL_SECTIONS) {
  test(`write_spec refuses a body missing the \`## ${missing}\` section (names it)`, async () => {
    const store = freshStore();
    const body = bodyWith(CANONICAL_SECTIONS.filter((s) => s !== missing));

    await assert.rejects(
      () => writeSpec(store, body),
      (err: unknown) => {
        const msg = (err as Error).message;
        assert.ok(
          msg.includes(missing),
          `refusal must name the missing section "${missing}" (got: ${msg})`,
        );
        return true;
      },
    );

    // ...and the refusal is total: nothing was persisted.
    const doc = await store.getFile(store.pathForSpecDoc(SPEC));
    assert.equal(
      doc,
      undefined,
      "a refused write_spec must not create the spec doc",
    );
  });
}

// ── accepted: a body carrying all four canonical sections is written ─────────
test("write_spec accepts a body with all four canonical sections", async () => {
  const store = freshStore();

  const res = (await writeSpec(store, bodyWith(CANONICAL_SECTIONS))) as {
    ok: boolean;
  };
  assert.equal(res.ok, true, "a complete body must be accepted");

  // ...and it actually landed on disk.
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the accepted spec doc must be persisted");
});

// ════════════════════════════════════════════════════════════════════════════
// SP-th4wqf AC1 — the **runnable** spec gate, driven through the real
// `create_slice` TOOL CALL (`dispatchTool`, the layer the live MCP server runs),
// not the pure `verificationRunnable` predicate in isolation.
//
// What this proves: `create_slice`→Ready refuses a slice whose parent Spec
// certifies an AC with a verification command pointing at a test target that is
// **absent from the thinking space repo's `tsconfig.test.json` `include`** — such a target
// compiles to nothing, so `node --test` never runs it and the AC would report ✓
// over a check that never executed (TEP-th3i18 / SP-E, row #8). A target whose
// source IS registered (so it actually compiles + runs) clears the gate.
//
// Altitude (spec constraint): the load-bearing claim is that the **handler**
// computes `repoState` — it parses the real on-disk `tsconfig.test.json` (a
// `verificationRunnable` `RepoState`) and consults the precheck. So we drive the
// handler over a tmp store whose `tsconfig.test.json` we seed, and assert the
// refusal/acceptance + resulting thinking space state — never call the helper directly.
// This unit CONSUMES the `verificationRunnable` contract: the gate it exercises
// is the one wired to that predicate, so the test can't pass unless the wiring
// (handler → repoState → precheck) is real.
// ════════════════════════════════════════════════════════════════════════════

// Seed a fresh thinking space whose `tsconfig.test.json` (the file the create_slice
// handler parses to build `repoState`) carries `include`, and whose Spec
// certifies its single AC with the given `run` command. The handler is
// workspace-rooted, so the config goes at `store.workspaceRoot` — the thinking space
// repo's own root — exactly where the real toolchain (`tsc -p tsconfig.test.json`)
// reads it.
async function seededRunnableStore(opts: {
  run: string;
  include: string[];
}): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-runnable-thinking space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  fs.writeFileSync(
    path.join(store.workspaceRoot, "tsconfig.test.json"),
    JSON.stringify({ include: opts.include }, null, 2),
  );
  // A Spec that already clears the *structural* Ready gate (one AC, one
  // `ac_verifications` entry with a `run`) — so the only thing left to decide is
  // whether that declared check is actually RUNNABLE.
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-1", ac_verifications: { "1": { run: opts.run } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

// Reuses the file-level `ctxFor` (its `promoteLocator` is a harmless superset for
// create_slice, which never consults it).
const createSliceVia = async (
  store: ThinkubeStore,
  args: Record<string, unknown>,
) => {
  await armApprovalForSlicing(store, SPEC);
  return dispatchTool(
    "create_slice",
    { spec: SPEC, ...args },
    ctxFor(store),
    () => {},
  );
};

// A file-pinned verification target as it appears in an `ac_verifications` `run`
// command (`node --test out-test/mcp/<name>.test.js`) and the matching `include`
// **source** entry (`src/mcp/<name>.test.ts`) — the precheck maps compiled → source.
const targetRun = (name: string) => `node --test out-test/mcp/${name}.test.js`;
const targetToken = (name: string) => `out-test/mcp/${name}.test.js`;
const sourceEntry = (name: string) => `src/mcp/${name}.test.ts`;

// ── refused: an AC verification target absent from tsconfig `include` ─────────
test("create_slice refuses a slice whose AC verification target is NOT in tsconfig.test.json's include (names it)", async () => {
  const store = await seededRunnableStore({
    run: targetRun("ghost"), //  ← declared check…
    include: [sourceEntry("landed")], //  …but `ghost`'s source is not in the compile set
  });

  await assert.rejects(
    () =>
      createSliceVia(store, {
        title: "ready it",
        body: "detail",
        files: ["src/foo.ts"],
      }),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.ok(
        msg.includes(targetToken("ghost")),
        `the refusal must NAME the un-runnable target "${targetToken("ghost")}" (got: ${msg})`,
      );
      return true;
    },
  );

  // The refusal is total: a slice that fails the runnable gate never lands.
  assert.deepEqual(
    await store.listSlices(SPEC),
    [],
    "a slice refused at the runnable gate must not be persisted",
  );
});

// ── accepted: a registered (compilable) target clears the runnable gate ──────
test("create_slice accepts a slice whose AC verification target IS registered in tsconfig.test.json", async () => {
  const store = await seededRunnableStore({
    run: targetRun("landed"),
    include: [sourceEntry("landed")], //  the target's source IS in the compile set
  });

  const res = (await createSliceVia(store, {
    title: "ready it",
    body: "detail",
    files: ["src/foo.ts"],
  })) as { slice: string };

  assert.match(
    res.slice,
    /^TEP-1_SP-1_SL-\d+$/,
    "a registered/compilable verification target must clear the runnable gate",
  );
  assert.equal(
    (await store.listSlices(SPEC)).length,
    1,
    "the accepted slice must be persisted on the thinking space",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// SP-th4wqf AC3 — **re-audit on AC change**, driven through the real `write_spec`
// + `create_slice` TOOL CALLS (`dispatchTool`, the layer the live MCP server
// runs), not a hash-equality assertion in isolation.
//
// What this proves: a Spec's `ac_verifications` certification is keyed to a hash
// of its `## Acceptance Criteria` block. Once the ACs are certified and a slice
// has cleared the → Ready gate, **editing the AC block** (via `write_spec`, or
// `patch_spec_section`) WITHOUT re-certifying voids that certification — the
// stamped hash now keys an outdated AC block — so the next `create_slice` is
// **blocked** as stale until the ACs are re-audited (TEP-th3i18 #2). The
// converse must also hold: editing a *non-AC* section leaves the certification
// intact, proving the hash is narrowed to the AC block (not the whole body).
//
// Altitude (spec constraint): assert on the `create_slice` BLOCK — the gate
// transition the live server makes — never on hash equality alone. This unit
// CONSUMES `openingGate`'s certification contract (the AC-block hash stamped at
// certification, invalidated on edit); the test can't pass unless the
// handler wiring (`write_spec` stamps it / `create_slice` consults it) is real.
// ════════════════════════════════════════════════════════════════════════════

// A fresh thinking space whose root `tsconfig.test.json` registers the AC's verification
// target's source — so the post-readyGate runnable precheck (AC1) clears and the
// only gate left to exercise is the AC-hash re-audit. The spec itself is authored
// through `write_spec` below (the tool under test), not pre-seeded.
function reauditStore(): ThinkubeStore {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-reaudit-thinking space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  fs.writeFileSync(
    path.join(store.workspaceRoot, "tsconfig.test.json"),
    JSON.stringify({ include: [sourceEntry("reaudited")] }, null, 2),
  );
  return store;
}

// A complete 4-section body (so the structural section gate, AC2, passes on
// creation) whose `## Acceptance Criteria` carries exactly the given checklist
// lines. Editing `acLines` changes the AC-block hash; the other sections are
// fixed placeholders, so they can never be what moves the hash.
function reauditBody(acLines: ReadonlyArray<string>): string {
  const parts = ["# Demo Spec", ""];
  for (const s of CANONICAL_SECTIONS) {
    parts.push(`## ${s}`, "");
    if (s === "Acceptance Criteria") parts.push(...acLines);
    else parts.push(`placeholder for ${s}`);
    parts.push("");
  }
  return parts.join("\n");
}

// `write_spec` via dispatch. Supplying `ac_verifications` is the certification
// event — the handler stamps the AC-block hash; omitting it preserves the
// existing map (and stamp), which is exactly an AC edit that must go stale.
const writeSpecCertified = (
  store: ThinkubeStore,
  body: string,
  acVerifications?: Record<string, unknown>,
) =>
  dispatchTool(
    "write_spec",
    {
      spec: SPEC,
      body,
      ...(acVerifications ? { ac_verifications: acVerifications } : {}),
    },
    ctxFor(store),
    () => {},
  );

// `patch_spec_section` via dispatch — the surgical single-section edit path; it
// preserves frontmatter (the stamp), so editing the AC section here voids the
// certification just like `write_spec` does.
const patchSection = (store: ThinkubeStore, section: string, content: string) =>
  dispatchTool(
    "patch_spec_section",
    { spec: SPEC, section, content },
    ctxFor(store),
    () => {},
  );

// The single certified AC's verification — a runnable target registered in
// `reauditStore`'s tsconfig, so the runnable precheck never masks the re-audit.
const REAUDIT_VERIFS = { "1": { run: targetRun("reaudited") } };

// ── blocked: editing the ACs via write_spec voids the certification ──────────
test("create_slice is BLOCKED after the ACs are edited via write_spec (certification goes stale)", async () => {
  const store = reauditStore();

  // 1. Author + certify: complete body, one AC, a runnable ac_verifications entry.
  const created = (await writeSpecCertified(
    store,
    reauditBody(["- [ ] the widget turns blue"]),
    REAUDIT_VERIFS,
  )) as { ok: boolean };
  assert.equal(created.ok, true, "the certified spec must be authored");

  // 2. Baseline: a slice lands while the certification is fresh (hash matches).
  const first = (await createSliceVia(store, {
    title: "first",
    body: "detail",
    files: ["src/foo.ts"],
  })) as { slice: string };
  assert.match(
    first.slice,
    /^TEP-1_SP-1_SL-\d+$/,
    "the baseline create_slice must clear the gate while certification is fresh",
  );

  // 3. Edit the AC block via write_spec WITHOUT re-certifying (no
  //    ac_verifications): the structurally-complete map is preserved, but its
  //    stamped hash now keys the *old* AC block.
  await writeSpecCertified(
    store,
    reauditBody(["- [ ] the widget turns green"]),
  );

  // 4. The next create_slice is refused: certification stale, re-audit required.
  await assert.rejects(
    () =>
      createSliceVia(store, {
        title: "second",
        body: "detail",
        files: ["src/bar.ts"],
      }),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.match(
        msg,
        /stale/i,
        `the refusal must report the certification as stale (got: ${msg})`,
      );
      return true;
    },
  );

  // The block is total: only the baseline slice exists; the stale-gated one
  // never landed.
  assert.equal(
    (await store.listSlices(SPEC)).length,
    1,
    "a slice refused at the re-audit gate must not be persisted",
  );
});

// ── blocked: editing the ACs via patch_spec_section voids it just the same ───
test("create_slice is BLOCKED after the ACs are edited via patch_spec_section (certification goes stale)", async () => {
  const store = reauditStore();

  await writeSpecCertified(
    store,
    reauditBody(["- [ ] the widget turns blue"]),
    REAUDIT_VERIFS,
  );
  // Baseline slice clears the fresh certification.
  await createSliceVia(store, {
    title: "first",
    body: "detail",
    files: ["src/foo.ts"],
  });

  // Surgically rewrite ONLY the Acceptance Criteria section — frontmatter (and
  // its stamp) is preserved, so the AC-block hash diverges from the stamp.
  await patchSection(
    store,
    "Acceptance Criteria",
    "- [ ] the widget turns red\n",
  );

  await assert.rejects(
    () =>
      createSliceVia(store, {
        title: "second",
        body: "detail",
        files: ["src/bar.ts"],
      }),
    (err: unknown) => {
      assert.match((err as Error).message, /stale/i);
      return true;
    },
  );
  assert.equal(
    (await store.listSlices(SPEC)).length,
    1,
    "a slice refused at the re-audit gate must not be persisted",
  );
});

// ── NOT stale: editing a non-AC section leaves the certification intact ──────
// Proves the certification hash is narrowed to the `## Acceptance Criteria`
// block — a Design edit (which `requirementHash` would otherwise fold in) must
// NOT re-require certification, or every spec edit would falsely block.
test("create_slice still clears the gate after a NON-AC section is edited (certification stays fresh)", async () => {
  const store = reauditStore();

  await writeSpecCertified(
    store,
    reauditBody(["- [ ] the widget turns blue"]),
    REAUDIT_VERIFS,
  );
  await createSliceVia(store, {
    title: "first",
    body: "detail",
    files: ["src/foo.ts"],
  });

  // Rewrite the Design section only — the AC block is byte-identical, so its
  // hash (and the certification) is unchanged.
  await patchSection(store, "Design", "A completely rewritten design.\n");

  const second = (await createSliceVia(store, {
    title: "second",
    body: "detail",
    files: ["src/bar.ts"],
  })) as { slice: string };
  assert.match(
    second.slice,
    /^TEP-1_SP-1_SL-\d+$/,
    "editing a non-AC section must not invalidate the AC certification",
  );
  assert.equal(
    (await store.listSlices(SPEC)).length,
    2,
    "both slices must persist — the second was never gated stale",
  );
});
