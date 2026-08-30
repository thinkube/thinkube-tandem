/**
 * TRANSITION — this test proves the change happened: src/surfaces/panel.ts
 * stops defining its own `vs()`/`req` pair and instead re-exports the one
 * `vs` function src/core/vscodeHost.ts defines, so the panel and every
 * other host-side module reach the editor host through a single
 * definition.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { vs as vsFromPanel } from "../surfaces/panel";
import { vs as vsFromHost } from "./vscodeHost";

test("panel re-exports the same vs function object vscodeHost defines", () => {
  assert.equal(
    vsFromPanel,
    vsFromHost,
    "src/surfaces/panel re-exports src/core/vscodeHost's vs rather than defining its own",
  );
});
