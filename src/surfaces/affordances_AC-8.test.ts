/**
 * TRANSITION — verifiedDoors now checks the door's page as well as its own
 * control: a door whose control renders on a page that itself never renders
 * is not really reachable, so it must not be reported as verified.
 *
 * Before this change a door was verified from its own handle alone. This
 * pins that a door is omitted from verifiedDoors when its page's handle is
 * absent, even though the door's own control handle is present in the
 * surface text. Its job is done once verifiedDoors checks both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedDoors, Door } from "./doors";
import { PAGES } from "./affordances";

test("verifiedDoors omits a door whose page handle is absent, even when the door's own control handle is present", () => {
  const doors: Door[] = [
    {
      action: "build",
      page: "work",
      label: "the work page",
      gesture: "press Build",
      handle: "data-build",
    },
  ];
  // The control's own handle is present, but the work page's own handle
  // (from PAGES) never appears — so the door is not reachable at all.
  const surfaceText = `<button data-build>Build</button>`;
  assert.ok(
    !surfaceText.includes(PAGES.work?.handle ?? "__no_such_page_handle__"),
    "set up: the work page's own handle is absent from the surface text",
  );

  const verified = verifiedDoors(surfaceText);

  assert.ok(
    !verified.some((d) => d.action === "build"),
    "a door on a page that never renders is not reported as verified, despite its own control handle being present",
  );
});
