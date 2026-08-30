/**
 * TRANSITION — this test proves the change happened: src/run/testHomes.ts
 * stops defining its own `isTestPath` and instead re-exports the one
 * function `src/core/testShape.ts` defines, so every reader of either
 * module path is reading the exact same rule, not two rules that happen
 * to agree today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestPath as isTestPathFromTestHomes } from "../run/testHomes";
import { isTestPath as isTestPathFromTestShape } from "./testShape";

test("testHomes re-exports the same isTestPath function object testShape defines", () => {
  assert.equal(
    isTestPathFromTestHomes,
    isTestPathFromTestShape,
    "src/run/testHomes re-exports src/core/testShape's isTestPath rather than defining its own",
  );
});
