/**
 * TRANSITION — the built surface is read once and held for a push, not
 * re-read for every delivery: spacePush renders a delivery page for each
 * delivery the space carries every time anything in the space changes, and
 * without holding the read, three deliveries would mean three (or more)
 * reads of the same built file on every single push.
 *
 * This pins that, with a counting reader injected, building the push for a
 * space with three deliveries reads the built surface exactly once — not
 * once per delivery and not once per push (i.e. not on a later push either,
 * once the surface has already been read and held).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spacePush } from "./push";
import { TandemSession } from "./session";
import { emptySpace, Delivery } from "../core/schema";

function throwawaySession(readBuiltSurface: () => string): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-affordances-ac22-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
    // The seam this criterion requires: the reader spacePush's held door
    // proof draws from, injectable so a test can count calls to it. Named
    // to match the existing readCurrentStamp injection convention.
    readBuiltSurface,
  } as ConstructorParameters<typeof TandemSession>[0]);
}

function delivery(id: string, cutId: string): Delivery {
  return { id, cutId, branch: `b-${id}`, proofs: [] };
}

test("building the push for a space with three deliveries reads the built surface once, not once per delivery and not once per push", () => {
  let reads = 0;
  const session = throwawaySession(() => {
    reads++;
    return "<div></div>";
  });

  session.space = {
    ...emptySpace(),
    cuts: [
      { id: "cut1", changeIds: [] },
      { id: "cut2", changeIds: [] },
      { id: "cut3", changeIds: [] },
    ],
    deliveries: [
      delivery("d1", "cut1"),
      delivery("d2", "cut2"),
      delivery("d3", "cut3"),
    ],
  };

  spacePush(session);
  assert.equal(reads, 1, "the built surface is read exactly once for a push rendering three deliveries, not once per delivery");

  spacePush(session);
  assert.equal(reads, 1, "a second push does not read the built surface again — it is held, not re-read on every push");
});
