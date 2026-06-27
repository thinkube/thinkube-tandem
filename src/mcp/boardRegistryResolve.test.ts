/**
 * BoardRegistry.resolve — a Project is a first-class but code-less board,
 * addressable by its `<product>/projects/<id>` namespace (TEP-5 / the project
 * layer). installVscodeStub pattern (stub imported FIRST, since resolve builds a
 * ThinkubeStore).
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { BoardRegistry } from "./kanbanMcpServer";

test("resolve addresses a Project as a first-class board (code-less, store path = board dir)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projboard-"));
  // A code-less project board: <product>/projects/<id> holding its org-tree teps.
  fs.mkdirSync(
    path.join(
      root,
      "Platform",
      "projects",
      "rebrand",
      "cmxela",
      "teps",
      "TEP-1",
    ),
    { recursive: true },
  );
  const reg = new BoardRegistry({ boardRoot: root, folders: [], roots: [] } as never);
  const store = reg.resolve("Platform/projects/rebrand");
  // Its store IS rooted at the project dir (no separate code repo).
  assert.equal(
    store.thinkubeDir,
    path.join(root, "Platform", "projects", "rebrand"),
  );
});

test("resolve still rejects an unknown non-project id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-projboard2-"));
  const reg = new BoardRegistry({ boardRoot: root, folders: [], roots: [] } as never);
  assert.throws(() => reg.resolve("Platform/nope/whatever"), /Unknown board/);
});
