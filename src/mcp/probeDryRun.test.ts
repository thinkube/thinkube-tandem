/**
 * Probe dry-run at signing time (2026-07-11): `write_spec` must never sign a
 * verification command whose leading token cannot resolve in the working repo
 * — the bare-`tsc` class. Resolution only (`command -v`), never execution.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { unresolvableProbeCommands } from "./kanbanMcpServer";

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-probe-dryrun-"));
}

test("a bare devDependency binary is flagged (the TEP-1_SP-4 AC5 case)", () => {
  const repo = tmpRepo();
  const bad = unresolvableProbeCommands(
    {
      "5": {
        run: "python3 -m compileall . && (cd frontend && this-binary-does-not-exist --noEmit)",
        env: "local",
      },
    },
    repo,
  );
  assert.equal(bad.length, 1);
  assert.equal(bad[0].token, "this-binary-does-not-exist");
  assert.equal(bad[0].ac, "5");
});

test("resolvable commands, builtins, and env assignments pass", () => {
  const repo = tmpRepo();
  const bad = unresolvableProbeCommands(
    {
      "1": { run: "sh -c 'exit 0' && cd sub && echo done", env: "local" },
      "2": { run: "FOO=bar ls -la; true", env: "local" },
    },
    repo,
  );
  assert.deepEqual(bad, []);
});

test("a repo-local node_modules/.bin binary resolves at the repo root", () => {
  const repo = tmpRepo();
  const bin = path.join(repo, "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  const tool = path.join(bin, "localtool");
  fs.writeFileSync(tool, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(tool, 0o755);
  assert.deepEqual(
    unresolvableProbeCommands({ "1": { run: "localtool --check", env: "local" } }, repo),
    [],
  );
});

test("assessment and cluster entries are never checked", () => {
  const repo = tmpRepo();
  assert.deepEqual(
    unresolvableProbeCommands(
      {
        "1": { env: "assessment" },
        "2": { run: "kubectl-on-cluster-only apply", env: "cluster" },
      },
      repo,
    ),
    [],
  );
});
