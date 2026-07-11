/**
 * space.yaml — the space card (TEP-14): the declared maintainer list and
 * the space marker. Parsing refuses loudly with the card named.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSpaceCard } from "./spaceManifest";

test("a card parses to its orgs list", () => {
  assert.deepEqual(parseSpaceCard(`orgs: [cmxela]\n`, "x/space.yaml"), {
    orgs: ["cmxela"],
  });
  assert.deepEqual(parseSpaceCard(`orgs: []\n`, "x/space.yaml"), { orgs: [] });
});

test("refusals name the card: bad orgs, unknown keys, non-mapping", () => {
  const cases: Array<[string, RegExp]> = [
    [`orgs: "cmxela"\n`, /`orgs` must be a list/],
    [`orgs: [a b]\n`, /single path segments/],
    [`orgs: [x, x]\n`, /unique/],
    [`orgs: []\nrepo:\n  remote: g.com/a/b\n`, /unknown key\(s\): repo/],
    [`- just\n- a list\n`, /must be a YAML mapping/],
  ];
  for (const [card, re] of cases) {
    assert.throws(
      () => parseSpaceCard(card, "the/offending/space.yaml"),
      (e: Error) =>
        re.test(e.message) && e.message.startsWith("the/offending/space.yaml:"),
      card,
    );
  }
});
