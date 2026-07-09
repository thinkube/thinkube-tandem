// SP-17/2 AC1 — rtkRewrite(command) is pure and explicit.
//
// WHY (INVARIANT — must always hold, lives forever): rtkRewrite must return the
// rtk-wrapped form for commands whose leading word(s) are on RTK_SUPPORTED and
// undefined (no rewrite) for unsupported commands, compound/pipeline lines, and
// already-prefixed commands — with no env or fs reads; its result must depend only
// on the command string. This is a standing behaviour: the rewriter's correctness
// and purity are a permanent contract.

import { test } from "node:test";
import assert from "node:assert/strict";

import { rtkRewrite, RTK_SUPPORTED } from "../services/rtkRewrite";

test("rtkRewrite returns 'rtk <command>' for each entry in the RTK_SUPPORTED starting set", () => {
  // The spec contract mandates this set as the initial entries.
  const startingSet = [
    "git status",
    "git diff",
    "git log",
    "grep",
    "rg",
    "find",
    "ls",
    "cat",
    "wc",
    "du",
  ];
  for (const cmd of startingSet) {
    assert.equal(
      rtkRewrite(cmd),
      `rtk ${cmd}`,
      `bare command "${cmd}" should be wrapped with rtk`,
    );
  }
});

test("rtkRewrite wraps a supported command that carries additional arguments", () => {
  // Supported leading word(s) + args → the whole command string is wrapped.
  assert.equal(rtkRewrite("git status --short"), "rtk git status --short");
  assert.equal(rtkRewrite("grep -r foo src/"), "rtk grep -r foo src/");
  assert.equal(
    rtkRewrite("find . -name '*.ts' -type f"),
    "rtk find . -name '*.ts' -type f",
  );
  assert.equal(rtkRewrite("ls -la /tmp"), "rtk ls -la /tmp");
  assert.equal(rtkRewrite("cat README.md"), "rtk cat README.md");
});

test("rtkRewrite returns undefined for a command whose leading word(s) are not on RTK_SUPPORTED", () => {
  // 'git push', 'echo', 'npm', etc. are not on the list.
  assert.equal(rtkRewrite("echo hello"), undefined);
  assert.equal(rtkRewrite("npm install"), undefined);
  assert.equal(rtkRewrite("curl https://example.com"), undefined);
  assert.equal(rtkRewrite("sed -i 's/a/b/' file.txt"), undefined);
  assert.equal(rtkRewrite("awk '{print $1}' file"), undefined);
  // 'git push' is NOT in RTK_SUPPORTED (only 'git status', 'git diff', 'git log').
  assert.equal(rtkRewrite("git push origin main"), undefined);
  // 'git' alone with no known sub-command combination is also unsupported.
  assert.equal(rtkRewrite("git commit -m 'msg'"), undefined);
});

test("rtkRewrite returns undefined for compound/pipeline command lines (safety: mangled command worse than uncompressed)", () => {
  // pipe
  assert.equal(
    rtkRewrite("git status | grep modified"),
    undefined,
    "pipe (|) → compound, no rewrite",
  );
  // logical AND
  assert.equal(
    rtkRewrite("git status && echo done"),
    undefined,
    "&& → compound, no rewrite",
  );
  // semicolon
  assert.equal(
    rtkRewrite("git status; ls"),
    undefined,
    "; → compound, no rewrite",
  );
  // output redirect >
  assert.equal(
    rtkRewrite("cat file.txt > output.txt"),
    undefined,
    "> → redirect, no rewrite",
  );
  // input redirect <
  assert.equal(
    rtkRewrite("wc -l < file.txt"),
    undefined,
    "< → redirect, no rewrite",
  );
  // command substitution $(
  assert.equal(
    rtkRewrite("find $(pwd) -name '*.ts'"),
    undefined,
    "$( → subshell, no rewrite",
  );
});

test("rtkRewrite returns undefined (idempotent) for a command already prefixed with 'rtk '", () => {
  // Once wrapped, wrapping again must be a no-op.
  assert.equal(rtkRewrite("rtk git status"), undefined, "already prefixed");
  assert.equal(
    rtkRewrite("rtk grep foo bar"),
    undefined,
    "already prefixed grep",
  );
  assert.equal(
    rtkRewrite("rtk find . -name '*.ts'"),
    undefined,
    "already prefixed find",
  );
});

test("rtkRewrite returns undefined for blank or whitespace-only input", () => {
  assert.equal(rtkRewrite(""), undefined, "empty string");
  assert.equal(rtkRewrite("   "), undefined, "spaces only");
  assert.equal(rtkRewrite("\t\n"), undefined, "tabs/newlines only");
});

test("rtkRewrite is pure — identical inputs always yield identical outputs", () => {
  // Multiple calls with the same input must always produce the same result (no hidden state).
  const cmd = "git status --short";
  assert.equal(rtkRewrite(cmd), rtkRewrite(cmd));

  const unsupported = "npm test";
  assert.equal(rtkRewrite(unsupported), rtkRewrite(unsupported));
  assert.equal(rtkRewrite(unsupported), undefined);

  const blank = "";
  assert.equal(rtkRewrite(blank), rtkRewrite(blank));
  assert.equal(rtkRewrite(blank), undefined);
});

test("rtkRewrite is env-independent — process.env mutations do not affect its result", () => {
  // Pure means no reads from the environment; the result must be stable under env changes.
  const prevEnabled = process.env.RTK_ENABLED;
  const prevPath = process.env.RTK_PATH;
  process.env.RTK_ENABLED = "false";
  process.env.RTK_PATH = "/nonexistent/rtk";
  try {
    assert.equal(
      rtkRewrite("git status"),
      "rtk git status",
      "env must not suppress a supported rewrite",
    );
    assert.equal(
      rtkRewrite("echo hi"),
      undefined,
      "env must not enable rewrites for unsupported commands",
    );
  } finally {
    if (prevEnabled === undefined) delete process.env.RTK_ENABLED;
    else process.env.RTK_ENABLED = prevEnabled;
    if (prevPath === undefined) delete process.env.RTK_PATH;
    else process.env.RTK_PATH = prevPath;
  }
});

test("rtkRewrite trims leading/trailing whitespace from the command before matching", () => {
  // TRIMMED command that matches RTK_SUPPORTED → wraps the trimmed form.
  assert.equal(rtkRewrite("  git status  "), "rtk git status");
  assert.equal(rtkRewrite("\tgrep -r foo .\t"), "rtk grep -r foo .");
  // TRIMMED unsupported command → still undefined.
  assert.equal(rtkRewrite("  echo hello  "), undefined);
});

test("RTK_SUPPORTED is a readonly array that includes the spec-mandated starting set", () => {
  // The contract specifies this exact set of entries as the starting set.
  const expected = [
    "git status",
    "git diff",
    "git log",
    "grep",
    "rg",
    "find",
    "ls",
    "cat",
    "wc",
    "du",
  ];
  assert.ok(Array.isArray(RTK_SUPPORTED), "RTK_SUPPORTED is an array");
  assert.ok(
    RTK_SUPPORTED.length >= expected.length,
    "RTK_SUPPORTED has at least the starting entries",
  );
  for (const entry of expected) {
    assert.ok(
      (RTK_SUPPORTED as readonly string[]).includes(entry),
      `RTK_SUPPORTED must include "${entry}"`,
    );
  }
});
