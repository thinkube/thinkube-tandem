/**
 * Handler test for `list_products`. Uses the installVscodeStub
 * pattern (import the stub FIRST) so importing the server module loads outside
 * the extension host; `main()` is guarded by `require.main === module`, so this
 * import does not boot the stdio server. `listProducts` only reads
 * `ctx.env.thinkingSpaceRoot` (pure fs), so a minimal ctx suffices.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { listProducts } from "./kanbanMcpServer";

function thinkingSpaceRootFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-prodtool-"));
  // Org-scoped tree: the thinking space dir holds its methodology under an `<org>/`
  // segment, so the `teps` marker sits one level below the thinking space.
  fs.mkdirSync(
    path.join(root, "Platform", "core", "thinkube", "cmxela", "teps"),
    {
      recursive: true,
    },
  );
  fs.writeFileSync(
    path.join(root, "Platform", "product.yaml"),
    "name: Thinkube Platform\n",
  );
  fs.mkdirSync(path.join(root, "Apps", "payments", "cmxela", "teps"), {
    recursive: true,
  });
  return root;
}

test("list_products returns products + members for the configured thinking space root", () => {
  const root = thinkingSpaceRootFixture();
  const res = listProducts({ env: { thinkingSpaceRoot: root } } as never) as {
    products: { id: string; name: string; members: string[] }[];
  };
  assert.deepEqual(
    res.products.map((p) => p.id),
    ["Apps", "Platform"],
  );
  const platform = res.products.find((p) => p.id === "Platform");
  assert.equal(platform?.name, "Thinkube Platform");
  assert.deepEqual(platform?.members, ["Platform/core/thinkube"]);
});

test("list_products returns an empty list when no thinking space root is configured", () => {
  const res = listProducts({ env: {} } as never) as { products: unknown[] };
  assert.deepEqual(res.products, []);
});
