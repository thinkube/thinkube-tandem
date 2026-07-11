/**
 * Unit tests for applyPluginEnablement. Pure — no vscode/fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyPluginEnablement,
  PLUGIN_ID,
  discoverMetadataMarketplaces,
} from "./pluginEnablement";

test("discoverMetadataMarketplaces: *-metadata repos with a manifest (official + user); others excluded", () => {
  const repos = [
    { name: "thinkube-metadata", path: "/r/thinkube-metadata" }, // official, has manifest
    { name: "acme-metadata", path: "/r/acme-metadata" }, // user tier, has manifest
    { name: "thinkube", path: "/r/thinkube" }, // not -metadata
    { name: "empty-metadata", path: "/r/empty-metadata" }, // -metadata but no manifest
  ];
  const names: Record<string, string | null> = {
    "/r/thinkube-metadata": "thinkube",
    "/r/acme-metadata": "acme",
    "/r/empty-metadata": null,
  };
  const found = discoverMetadataMarketplaces(repos, (p) => names[p] ?? null);
  assert.deepEqual(
    found.map((m) => `${m.repo}:${m.marketplaceName}`),
    ["thinkube-metadata:thinkube", "acme-metadata:acme"],
  );
});

test("from empty: adds map-form enabledPlugins with the plugin id (changed)", () => {
  const { settings, changed } = applyPluginEnablement({});
  assert.equal(changed, true);
  assert.equal(Array.isArray(settings.enabledPlugins), false); // MAP, not array
  assert.deepEqual(settings.enabledPlugins, { [PLUGIN_ID]: true });
});

test("idempotent: re-applying its own output is a no-op (changed=false, stable)", () => {
  const first = applyPluginEnablement({});
  const second = applyPluginEnablement(first.settings);
  assert.equal(second.changed, false);
  assert.deepEqual(second.settings, first.settings);
});

test("non-clobbering: existing keys and other plugins survive", () => {
  const input = {
    permissions: { allow: ["Bash(git *)"] },
    hooks: { Stop: [{ matcher: "*" }] },
    enabledPlugins: { "other@mp": true },
  };
  const { settings, changed } = applyPluginEnablement(input);
  assert.equal(changed, true);
  assert.deepEqual(settings.permissions, { allow: ["Bash(git *)"] });
  assert.deepEqual(settings.hooks, { Stop: [{ matcher: "*" }] });
  assert.equal((settings.enabledPlugins as Record<string, unknown>)["other@mp"], true);
  assert.equal((settings.enabledPlugins as Record<string, unknown>)[PLUGIN_ID], true);
});

test("legacy array enabledPlugins is upgraded to map-form, preserving entries", () => {
  const { settings, changed } = applyPluginEnablement({ enabledPlugins: ["other@mp"] });
  assert.equal(changed, true);
  assert.equal(Array.isArray(settings.enabledPlugins), false);
  assert.deepEqual(settings.enabledPlugins, { "other@mp": true, [PLUGIN_ID]: true });
});

test("does not touch unrelated settings (only enabledPlugins)", () => {
  const { settings } = applyPluginEnablement({ extraKnownMarketplaces: { x: 1 } });
  assert.deepEqual(settings.extraKnownMarketplaces, { x: 1 });
});
