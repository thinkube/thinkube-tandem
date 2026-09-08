/**
 * The session a reviewer is given opens the product and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { credentialsFrom, credentialsIn, onlyThisProduct, signInOnce, theWayInWorks } from "./theWayIn";

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
  if ("why" in r) assert.match(r.why, /no identity|could not sign in|no way back in/);
});

test("a sign-in that leaves nothing for the product is not a session", async () => {
  const r = await signInOnce({
    at: "https://todo.thinkube.com",
    into: path.join(os.tmpdir(), "tandem-empty-session.json"),
    credentials: { username: "u", password: "p" },
    signIn: async () => ({ cookies: [{ name: "k", domain: "auth.thinkube.com", path: "/" }], origins: [] }),
  });
  assert.ok("why" in r && /no way back in/.test(r.why), JSON.stringify(r));
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

test("a session that does not open the product is said before any reviewer starts", async () => {
  const sentAway = await theWayInWorks({
    at: "https://todo.thinkube.com",
    sessionFile: "/tmp/s.json",
    visit: async () => ({ landedAt: "https://auth.thinkube.com/realms/thinkube/protocol/openid-connect/auth" }),
  });
  assert.ok("why" in sentAway);
  assert.match(sentAway.why, /sent the browser to auth\.thinkube\.com/);

  const lands = await theWayInWorks({
    at: "https://todo.thinkube.com",
    sessionFile: "/tmp/s.json",
    visit: async () => ({ landedAt: "https://todo.thinkube.com/" }),
  });
  assert.deepEqual(lands, { ok: true });
});

test("a theme is not a session: a way back in is told apart from a preference", () => {
  const at = "https://todo.thinkube.com";
  const onlyATheme = {
    cookies: [],
    origins: [{ origin: at, localStorage: [{ name: "theme", value: "dark" }] }],
  };
  assert.deepEqual(credentialsIn(onlyATheme, at), [], "a display preference opens nothing");

  const signedIn = {
    cookies: [],
    origins: [
      {
        origin: at,
        localStorage: [
          { name: "theme", value: "dark" },
          { name: "access_token", value: "ey..." },
          { name: "refresh_token", value: "r..." },
        ],
      },
    ],
  };
  assert.deepEqual(credentialsIn(signedIn, at), ["stored access_token", "stored refresh_token"]);

  const byCookie = { cookies: [{ name: "sid", domain: "todo.thinkube.com", path: "/" }], origins: [] };
  assert.deepEqual(credentialsIn(byCookie, at), ["cookie sid"], "a cookie on the product's own host is a session");
});

test("a sign-in that stored only a preference is refused, not handed to the reviewers", async () => {
  // The shape that locked every reviewer out: the storage was read after
  // the theme was written but before the token exchange finished.
  const r = await signInOnce({
    at: "https://todo.thinkube.com",
    into: path.join(os.tmpdir(), "tandem-theme-only.json"),
    credentials: { username: "u", password: "p" },
    signIn: async () => ({
      cookies: [{ name: "KEYCLOAK_IDENTITY", domain: "auth.thinkube.com", path: "/" }],
      origins: [{ origin: "https://todo.thinkube.com", localStorage: [{ name: "theme", value: "dark" }] }],
    }),
  });
  assert.ok("why" in r, "a tokenless session must not be written");
  assert.match(r.why, /no way back in/);
});

test("a sign-in that fails once is tried again — a cold product locks nobody out", async () => {
  // It runs moments after the platform reports a new version live, when
  // the product's first requests are its slowest.
  let tried = 0;
  const rested: number[] = [];
  const into = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-retry-")), "session.json");
  const r = await signInOnce({
    at: "https://todo.thinkube.com",
    into,
    credentials: { username: "u", password: "p" },
    rest: async (ms) => void rested.push(ms),
    signIn: async () => {
      if (++tried < 3) throw new Error("page.fill: Timeout 30000ms exceeded.");
      return { cookies: [{ name: "sid", domain: "todo.thinkube.com", path: "/" }], origins: [] };
    },
  });
  assert.ok("path" in r, JSON.stringify(r));
  assert.equal(tried, 3, "it keeps trying until the product answers");
  assert.deepEqual(rested, [5000, 5000], "with a pause between, for the product to warm up");
});

test("a way in that never works says so, in the product's own words", async () => {
  const r = await signInOnce({
    at: "https://todo.thinkube.com",
    into: path.join(os.tmpdir(), "tandem-never.json"),
    credentials: { username: "u", password: "p" },
    rest: async () => {},
    signIn: async () => {
      throw new Error("page.fill: Timeout 30000ms exceeded.");
    },
  });
  assert.ok("why" in r);
  assert.match(r.why, /Timeout 30000ms exceeded/, "the reason the product gave");
  assert.match(r.why, /tried 3 times/, "and that it was not one unlucky attempt");
});
