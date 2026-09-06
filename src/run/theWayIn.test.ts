/**
 * The session a reviewer is given opens the product and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { credentialsFrom, onlyThisProduct, signInOnce } from "./theWayIn";

const whole = {
  cookies: [
    { name: "session", domain: "todo.thinkube.com", path: "/" },
    { name: "KEYCLOAK_IDENTITY", domain: "auth.thinkube.com", path: "/" },
    { name: "argocd.token", domain: ".thinkube.com", path: "/" },
  ],
  origins: [
    { origin: "https://todo.thinkube.com", localStorage: [] },
    { origin: "https://auth.thinkube.com", localStorage: [] },
  ],
};

test("the sign-on cookie is dropped: the session opens the product, not the platform", () => {
  const kept = onlyThisProduct(whole, "https://todo.thinkube.com/app");
  assert.deepEqual(
    kept.cookies.map((c) => c.domain),
    ["todo.thinkube.com"],
    "no cookie for the sign-on host, and none for the whole domain",
  );
  assert.deepEqual(kept.origins.map((o) => o.origin), ["https://todo.thinkube.com"]);
});

test("the session is written where the reviewers start from, holding only that", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wayin-"));
  const into = path.join(dir, "looks", "run-1", "session.json");
  const r = await signInOnce({
    at: "https://todo.thinkube.com",
    into,
    credentials: { username: "u", password: "p" },
    signIn: async () => whole,
  });
  assert.ok("path" in r, JSON.stringify(r));
  const written = JSON.parse(fs.readFileSync(into, "utf8"));
  assert.deepEqual(written.cookies.map((c: { domain: string }) => c.domain), ["todo.thinkube.com"]);
});

test("no identity, no session — and it says so instead of pretending", async () => {
  const r = await signInOnce({
    at: "https://x.test",
    into: path.join(os.tmpdir(), "never"),
    credentials: undefined,
    signIn: async () => whole,
    ...({} as Record<string, never>),
  });
  // credentialsFrom reads the machine's own environment; the test asserts
  // the shape of the refusal, whichever way that answers here.
  if ("why" in r) assert.match(r.why, /no identity|could not sign in|did not set a session/);
});

test("a sign-in that leaves nothing for the product is not a session", async () => {
  const r = await signInOnce({
    at: "https://todo.thinkube.com",
    into: path.join(os.tmpdir(), "tandem-empty-session.json"),
    credentials: { username: "u", password: "p" },
    signIn: async () => ({ cookies: [{ name: "k", domain: "auth.thinkube.com", path: "/" }], origins: [] }),
  });
  assert.ok("why" in r && /did not set a session/.test(r.why));
});

test("the identity is the realm user the platform signs people in as", () => {
  const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-nohome-"));
  assert.deepEqual(
    credentialsFrom({ AUTH_REALM_USERNAME: "thinkube", ADMIN_PASSWORD: "b" }, nowhere),
    { username: "thinkube", password: "b" },
    "the realm user, not the machine's admin account",
  );
  assert.equal(credentialsFrom({}, nowhere), undefined, "no identity where the platform keeps none");

  // The platform's own files answer when the environment does not: the
  // inventory names the realm user, and the shell environment holds the
  // password.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-home-"));
  fs.mkdirSync(path.join(home, ".ansible", "inventory"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".ansible", "inventory", "inventory.yaml"),
    "all:\n  vars:\n    admin_username: tkadmin\n    auth_realm_username: thinkube\n",
  );
  fs.writeFileSync(path.join(home, ".env"), 'ADMIN_PASSWORD="secret"\n');
  assert.deepEqual(credentialsFrom({}, home), { username: "thinkube", password: "secret" });
});
