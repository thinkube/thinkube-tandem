/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** read_space shows the readiness the store keeps, whichever process gave
 *  it, and says a HEAD that cannot be read in git's words. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolTable } from "./tools";
import type { Readiness } from "../run/readiness";

function spaceWith(readinessKept: () => Readiness[]) {
  return {
    running: false,
    space: { deliveries: [], asks: [], nodes: [], cuts: [], questions: [], subjects: [] },
    unrunCut: () => undefined,
    deps: { readinessKept },
  };
}

const readSpace = (session: unknown): string =>
  toolTable()
    .find((t) => t.name === "read_space")!
    .run({ session, project: { card: { label: "svc" } }, storeDir: "", args: {} } as never) as string;

test("read_space shows the readiness kept in the store", () => {
  const text = readSpace(
    spaceWith(() => [
      {
        repoRoot: "/repo/svc",
        head: "a".repeat(40),
        at: "2026-10-15T12:00:00.000Z",
        items: [
          { name: "setup", ready: true, say: "the setup holds" },
          { name: "deploy works", ready: false, say: "the declared deploy failed" },
        ],
      },
    ]),
  );
  assert.match(text, /readiness of \/repo\/svc at aaaaaaaa \(2026-10-15T12:00:00\.000Z\): NOT ready/);
  assert.match(text, /NOT ready deploy works — the declared deploy failed/);
});

test("read_space says why the kept readiness could not be read", () => {
  const text = readSpace(
    spaceWith(() => {
      throw new Error("Command failed: git -C /repo/svc rev-parse HEAD\nfatal: not a git repository");
    }),
  );
  assert.match(text, /readiness: the kept answer could not be read — Command failed: git -C \/repo\/svc rev-parse HEAD/);
});
