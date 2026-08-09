import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthor } from "./author";

const deps = (env: Record<string, string | undefined>, hosts?: string) => ({
  env,
  home: "/home/someone",
  readFile: (p: string) =>
    p === "/home/someone/.config/gh/hosts.yml" ? hosts : undefined,
});

test("the author is the person's GitHub account, from the platform's variable", () => {
  assert.equal(resolveAuthor(deps({ GITHUB_USERNAME: "cmxela" })), "cmxela");
});

test("without the variable, the GitHub CLI's recorded login is the same account", () => {
  const hosts = "github.com:\n    users:\n        cmxela:\n    user: cmxela\n";
  assert.equal(resolveAuthor(deps({}, hosts)), "cmxela");
});

test("no identity is refused — never a name every installation would share", () => {
  // The machine user, the git email local part and every other platform
  // constant are absent on purpose: they identify nobody.
  assert.equal(resolveAuthor(deps({ USER: "tkadmin", LOGNAME: "tkadmin" })), undefined);
  assert.equal(resolveAuthor(deps({ GITHUB_USERNAME: "   " })), undefined);
});
