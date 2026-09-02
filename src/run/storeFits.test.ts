/**
 * A dependency store installed for another C library is not borrowed.
 *
 * The pipeline's test container, on Alpine, wrote musl builds of rollup
 * into the shared checkout; the door borrowed that store and the product
 * build died with "cannot find module rollup-linux-x64-gnu".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { storeIsForAnotherLibc } from "./storeFits";

function store(packages: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  fs.writeFileSync(path.join(dir, ".package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  return dir;
}

test("a store with musl-only native modules is refused on a glibc host, and says why", () => {
  const dir = store({ "node_modules/@rollup/rollup-linux-x64-musl": { os: ["linux"], libc: ["musl"] } });
  assert.match(storeIsForAnotherLibc(dir, "glibc") ?? "", /installed for musl, and this machine runs glibc/);
  assert.equal(storeIsForAnotherLibc(dir, "musl"), undefined, "the same store fits an Alpine host");
});

test("a store with no native modules, or with this host's, is fine", () => {
  assert.equal(storeIsForAnotherLibc(store({ "node_modules/vue": {} }), "glibc"), undefined);
  assert.equal(storeIsForAnotherLibc(store({ "node_modules/@rollup/rollup-linux-x64-gnu": { libc: ["glibc"] } }), "glibc"), undefined);
  assert.equal(storeIsForAnotherLibc(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-nolock-")), "glibc"), undefined, "no lock file: nothing to judge");
});
