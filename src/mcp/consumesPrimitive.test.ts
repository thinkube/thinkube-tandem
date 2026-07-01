/**
 * SP-th4wqk — `consumes` as a first-class work-unit primitive. This is the
 * INTEGRATION test that CONSUMES all three producers of the slice, driving the
 * REAL handlers (the spec's verification-altitude constraint), never a pure
 * helper in isolation:
 *
 *   • AC#1 (round-trip): the typed `Frontmatter.work_units[].consumes` field
 *     (`../store/frontmatter`) — serialize a slice whose work_unit carries
 *     `consumes`, read it back through the real `parseFrontmatter`, and assert
 *     `consumes` survives ON THE TYPED SHAPE. The `.consumes` access below
 *     type-checks only because the field is declared — proving it round-trips by
 *     design, not merely because the YAML parser keeps unknown keys.
 *   • AC#2 (refuses): the `create_slice` door check (`./kanbanMcpServer`),
 *     driven via `dispatchTool` over a tmp `ThinkubeStore` — a `consumes` that
 *     names no sibling footprint is REFUSED, naming the offending unit + the
 *     dangling file; a `consumes` naming a real sibling footprint is ACCEPTED.
 *   • AC#3 (prompt): `buildWorkerPrompt` (`../services/orchestratorCore`),
 *     called directly on a unit produced by the real `buildUnitDag` — the
 *     consumed file is surfaced as a contract dependency the worker must IMPORT,
 *     not re-invent (structural, not buried in the prose `note`).
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "./kanbanMcpServer";
import {
  type Frontmatter,
  parseFrontmatter,
  serializeFrontmatter,
} from "../store/frontmatter";
import { buildUnitDag, buildWorkerPrompt } from "../services/orchestratorCore";

// ── tmp-store scaffolding (mirrors createSliceContractFirst.test.ts) ─────────
async function seededStore(spec = "1/1"): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-consumes-thinking space-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(spec),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

const create = (store: ThinkubeStore, args: Record<string, unknown>) =>
  dispatchTool(
    "create_slice",
    // SP-6/3: a multi-unit slice requires a design-time contract; supply a default so these
    // fixtures exercise the consumes gates, not the contract-required refusal. (A caller may
    // override.)
    { spec: "1/1", contract: "interface Contract { /* shared seam */ }", ...args },
    ctxFor(store),
    () => {},
  );

// ── AC#1: typed round-trip — consumes survives by design, not by luck ────────
test("consumes round-trip — serialize + parseFrontmatter returns it on the typed work_units shape", () => {
  // Author a real Frontmatter whose work_unit carries `consumes`. This object
  // literal type-checks against `Frontmatter`, so the field is part of the
  // declared shape — not a stray key tolerated by the YAML parser.
  const fm: Frontmatter = {
    kind: "slice",
    uid: "demo-consumes",
    parent: "SP-1",
    status: "ready",
    work_units: [
      {
        footprint: ["src/contract.ts"],
        execution: "fan-out",
        note: "producer",
      },
      {
        footprint: ["src/flow.test.ts"],
        execution: "fan-out",
        consumes: ["src/contract.ts"],
        note: "consumer",
      },
    ],
  };

  const text = serializeFrontmatter({ frontmatter: fm, body: "# Slice\n" });
  const back = parseFrontmatter(text).frontmatter;
  assert.ok(back, "round-tripped frontmatter parses");

  // Typed access: `.work_units[].consumes` only compiles because the field is
  // declared on the typed shape (AC#1's "typed, not preserved-by-luck").
  const consumer = back!.work_units?.find((u) =>
    u.footprint.includes("src/flow.test.ts"),
  );
  assert.ok(consumer, "the consuming unit round-trips");
  assert.deepEqual(
    consumer!.consumes,
    ["src/contract.ts"],
    "consumes survives the round-trip on the typed work_units shape",
  );
});

// ── AC#2: a dangling consumes is refused; a real sibling consumes is accepted ─
test("create_slice refuses a dangling consumes and accepts a real-sibling consumes", async () => {
  const store = await seededStore();

  // Dangling: the consumed file matches NO sibling unit's footprint → refused,
  // naming the offending unit (its footprint) + the dangling consumed file.
  await assert.rejects(
    create(store, {
      title: "bad: consumes a file no sibling produces",
      body: "detail",
      work_units: [
        {
          footprint: ["src/contract.ts"],
          execution: "fan-out",
          note: "producer",
        },
        {
          footprint: ["src/flow.test.ts"],
          execution: "fan-out",
          consumes: ["src/nope.ts"], // produced by no sibling
          note: "consumer",
        },
      ],
    }),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.match(msg, /consumes/i, "refusal mentions consumes");
      assert.match(
        msg,
        /flow\.test\.ts/,
        "refusal names the offending unit by its footprint",
      );
      assert.match(msg, /nope\.ts/, "refusal names the dangling consumed file");
      return true;
    },
  );

  // Accepted: the SAME shape, but `consumes` now names a real sibling footprint.
  const res = (await create(store, {
    title: "good: consumes a real sibling footprint",
    body: "detail",
    work_units: [
      {
        footprint: ["src/contract.ts"],
        execution: "fan-out",
        note: "producer",
      },
      {
        footprint: ["src/flow.test.ts"],
        execution: "fan-out",
        consumes: ["src/contract.ts"], // produced by the sibling above
        note: "consumer",
      },
    ],
  })) as { slice: string };
  assert.match(
    res.slice,
    /^TEP-1_SP-1_SL-\d+$/,
    "a consumes naming a real sibling footprint is accepted",
  );
});

// ── the DAG is Spec-global: a consumes may name ANOTHER slice's producer ──────
test("create_slice accepts a CROSS-SLICE consumes — the work-unit DAG is Spec-global, not slice-local", async () => {
  const store = await seededStore();

  // SL-1 produces the contract.
  await create(store, {
    title: "producer slice",
    body: "detail",
    work_units: [
      { footprint: ["src/contract.ts"], execution: "fan-out", note: "producer" },
    ],
  });

  // SL-2's unit consumes that contract — produced by NO unit in SL-2, only by
  // SL-1. Under the Spec-global DAG this is a normal cross-slice edge, accepted;
  // the old slice-local gate wrongly refused it as "dangling".
  const res = (await create(store, {
    title: "consumer slice (cross-slice consumes)",
    body: "detail",
    work_units: [
      {
        footprint: ["src/flow.ts"],
        execution: "fan-out",
        consumes: ["src/contract.ts"], // produced by SL-1, another slice
        note: "consumes SL-1's contract",
      },
    ],
  })) as { slice: string };
  assert.match(
    res.slice,
    /^TEP-1_SP-1_SL-\d+$/,
    "a consumes produced by another slice's unit is accepted",
  );
});

test("create_slice still refuses a consumes produced by NO unit in the whole Spec", async () => {
  const store = await seededStore();
  await create(store, {
    title: "producer slice",
    body: "detail",
    work_units: [
      { footprint: ["src/contract.ts"], execution: "fan-out", note: "producer" },
    ],
  });
  // Consumes a path no unit in SL-1 or SL-2 produces → still dangling.
  await assert.rejects(
    create(store, {
      title: "bad cross-spec consumes",
      body: "detail",
      work_units: [
        {
          footprint: ["src/flow.ts"],
          execution: "fan-out",
          consumes: ["src/ghost.ts"],
          note: "no producer anywhere",
        },
      ],
    }),
    (err: unknown) => {
      const msg = (err as Error).message;
      assert.match(msg, /ghost\.ts/, "names the dangling file");
      assert.match(msg, /anywhere in this Spec/i, "explains the global scope");
      return true;
    },
  );
});

// ── AC#3: the worker prompt names the consumed file as a contract dependency ──
test("buildWorkerPrompt surfaces the consumed file as a contract dependency to import, not re-invent", () => {
  // Build the execution-unit DAG via the REAL buildUnitDag, then prompt the
  // consuming unit — so the prompt is driven over a real SchedUnit, not a
  // hand-rolled one.
  const dag = buildUnitDag([
    {
      handle: "TEP-1_SP-1_SL-1",
      status: "ready",
      requires: [],
      files: [],
      workUnits: [
        {
          footprint: ["src/contract.ts"],
          execution: "fan-out",
          note: "producer",
        },
        {
          footprint: ["src/flow.test.ts"],
          execution: "fan-out",
          consumes: ["src/contract.ts"],
          note: "consumer",
        },
      ],
    },
  ]);

  const consumer = dag.find((u) => u.footprint.includes("src/flow.test.ts"));
  assert.ok(consumer, "the consuming unit is in the DAG");

  const prompt = buildWorkerPrompt(consumer!, "1/1");

  // The consumed file appears, framed as a contract dependency to import.
  assert.match(
    prompt,
    /src\/contract\.ts/,
    "prompt names the consumed file path",
  );
  assert.match(
    prompt,
    /contract dependency/i,
    "the consumed file is framed as a contract dependency, not buried in the note",
  );
  assert.match(
    prompt,
    /import .*contract|do not re-invent/i,
    "prompt tells the worker to import the contract, not re-invent it",
  );
});
