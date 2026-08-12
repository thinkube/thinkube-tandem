import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SliceForDag } from "../engine/core/dag";
import { claimRunLock } from "./plan";

const slice = (file: string): SliceForDag[] =>
  [
    {
      handle: "SL-1",
      status: "ready",
      files: [file],
      workUnits: [{ footprint: [file], execution: "serial", role: "code" }],
      satisfies: [1],
      contract: "",
    },
  ] as unknown as SliceForDag[];

const wtRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "tandem-lock-"));

test("two live runs cannot write the same files: the second is refused, naming the first", async () => {
  const root = wtRoot();
  const first = await claimRunLock(root, "run-a", "space/TEP-1", slice("src/a.ts"), {
    alive: () => true,
  });
  assert.equal(first.refusal, undefined);
  const second = await claimRunLock(root, "run-b", "space/TEP-2", slice("src/a.ts"), {
    alive: () => true,
  });
  assert.match(second.refusal!, /space\/TEP-1/);
  assert.match(second.refusal!, /src\/a\.ts/);
  // The refused claim owns no lock: its unlock must not free the winner's.
  await second.unlock();
  const third = await claimRunLock(root, "run-c", "space/TEP-3", slice("src/a.ts"), {
    alive: () => true,
  });
  assert.match(third.refusal!, /space\/TEP-1/, "the first run still holds the repository");
});

test("a lock whose process is gone is stale: cleared, said, and stepped over", async () => {
  const root = wtRoot();
  await claimRunLock(root, "run-a", "space/TEP-1", slice("src/a.ts"), { alive: () => true });
  const said: string[] = [];
  const claim = await claimRunLock(root, "run-b", "space/TEP-2", slice("src/a.ts"), {
    alive: () => false,
    log: (l) => said.push(l),
  });
  assert.equal(claim.refusal, undefined, "a dead run's lock never blocks a dispatch");
  assert.ok(
    said.some((l) => /left by a process that is gone/.test(l)),
    "the clearing is spoken, not silent",
  );
  assert.ok(
    !fs.existsSync(path.join(root, "locks", "run-a.json")),
    "the stale lock is removed from disk",
  );
});

test("a lock without a pid cannot be verified and is treated as stale", async () => {
  const root = wtRoot();
  fs.mkdirSync(path.join(root, "locks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "locks", "old.json"),
    JSON.stringify({ runName: "space/TEP-old", footprints: ["src/a.ts"] }),
  );
  const claim = await claimRunLock(root, "run-b", "space/TEP-2", slice("src/a.ts"), {
    alive: () => true,
  });
  assert.equal(claim.refusal, undefined, "a pre-liveness lock never blocks forever");
});

test("finishing a run frees the repository for the next one", async () => {
  const root = wtRoot();
  const first = await claimRunLock(root, "run-a", "space/TEP-1", slice("src/a.ts"), {
    alive: () => true,
  });
  await first.unlock();
  const second = await claimRunLock(root, "run-b", "space/TEP-2", slice("src/a.ts"), {
    alive: () => true,
  });
  assert.equal(second.refusal, undefined);
});
