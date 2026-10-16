/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a repository must be before work is signed against it, asked of a
 * repository on disk with every command, every request and control itself
 * injected — no shell, no network, no deploy.
 *
 * Each item answers ready or not, and when not, says what to do. The
 * answer is kept per HEAD and per declaration, so the second question
 * about the same tree runs nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkReadiness, readinessNow, readinessRefusal } from "./readiness";

const HEAD = "a".repeat(40);
/** One store for every test: answers are keyed by checkout, and each test
 *  makes its own. */
const HOME = { storeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-store-")), repoId: "svc-abc123" };
const FILES = ["app/main.py", "app/store.py", "tests/test_main.py", "run_tests.sh", "thinkube.yaml", "manifest.yaml"];

function thinkubeYaml(o: { version?: string; deploy?: boolean; health?: boolean; live?: string[] } = {}): string {
  return [
    "apiVersion: thinkube.io/v1",
    "kind: ThinkubeDeployment",
    "metadata:",
    `  version: "${o.version ?? "0.1.0"}"`,
    "spec:",
    "  containers:",
    "    - name: svc",
    "      build: .",
    ...(o.health === false ? [] : ["      health: /health"]),
    ...(o.deploy === false ? [] : ["  deploy:", "    run: ./deploy.sh", "    at: https://svc.example.com/"]),
    ...(o.deploy === false ? [] : (o.live ?? ["    live:", "      home: live", '      one: "python3 -m pytest -q <file>"'])),
  ].join("\n");
}

/** A template repository on disk: its declarations and its setup facts. */
function template(o: { yaml?: string; secrets?: string[]; facts?: Record<string, unknown> } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-"));
  fs.writeFileSync(path.join(root, "thinkube.yaml"), o.yaml ?? thinkubeYaml());
  fs.writeFileSync(
    path.join(root, "manifest.yaml"),
    [
      "kind: TemplateManifest",
      "metadata:",
      "  name: svc",
      ...((o.secrets ?? ["DB_URL"]).length ? ["secrets:", ...(o.secrets ?? ["DB_URL"]).map((n) => `  - name: ${n}`)] : []),
    ].join("\n"),
  );
  fs.mkdirSync(path.join(root, ".tandem"));
  fs.writeFileSync(
    path.join(root, ".tandem", "setup.json"),
    JSON.stringify(
      o.facts ?? { provision: "pip install -r requirements.txt", prepare: "", runOne: "./run_tests.sh <file>", suite: "./run_tests.sh", build: "python3 -m compileall -q app" },
    ),
  );
  return root;
}

/** git, answered: HEAD (which a deploy may move), the common directory,
 *  the tracked files, origin's tags; everything else succeeds. */
function git(o: { files?: string[]; tags?: string } = {}) {
  const calls: string[] = [];
  const state = { head: HEAD, common: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-git-")) };
  return {
    calls,
    state,
    exec: async (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.slice(2).join(" ")}`);
      if (cmd !== "git") return { code: 0, out: "" };
      const sub = args[2];
      if (sub === "rev-parse")
        return {
          code: 0,
          out: args[3] === "HEAD" ? `${state.head}\n` : args[3] === "--git-common-dir" ? `${state.common}\n` : "",
        };
      if (sub === "ls-files") return { code: 0, out: (o.files ?? FILES).join("\n") };
      if (sub === "ls-remote")
        return o.tags === undefined ? { code: 128, out: "fatal: could not read from remote repository" } : { code: 0, out: o.tags };
      return { code: 0, out: "" };
    },
  };
}

/** The door's commands: each one recorded, and the named one failing. */
function door(fail?: { cmd: string; output: string }) {
  const ran: string[] = [];
  return {
    ran,
    boundedExec: async (cmd: string) => {
      ran.push(cmd);
      return cmd === fail?.cmd ? { code: 1, output: fail.output } : { code: 0, output: "1 passed" };
    },
  };
}

/** Control's secrets and the deployed health path, answered. */
function web(o: { secrets?: string[]; health?: number } = {}) {
  const asked: string[] = [];
  return {
    asked,
    http: async (url: string) => {
      asked.push(url);
      if (url.endsWith("/api/v1/secrets/"))
        return new Response(JSON.stringify((o.secrets ?? ["DB_URL"]).map((name, id) => ({ id, name }))), { status: 200 });
      return new Response("", { status: o.health ?? 200 });
    },
  };
}

const control = () => ({ base: "https://control.example.com", token: "tok" });

/** The declared deploy: recorded, failing with the given words, or moving
 *  HEAD to a release commit as a template's deploy does. */
function deployer(fail?: string, release?: { state: { head: string }; to: string }) {
  const ran: { command: string; env?: Record<string, string> }[] = [];
  return {
    ran,
    invoke: async (command: string, _cwd: string, env?: Record<string, string>) => {
      ran.push({ command, ...(env ? { env } : {}) });
      if (!fail && release) release.state.head = release.to;
      return fail ? { code: 1, out: fail } : { code: 0, out: "deployed" };
    },
  };
}

const item = (r: Awaited<ReturnType<typeof checkReadiness>>, name: string) => {
  const found = r.items.find((i) => i.name === name);
  assert.ok(found, `no item "${name}" in ${r.items.map((i) => i.name).join(", ")}`);
  return found!;
};

test("a template whose setup holds, whose checks land in its tests, declared, tagged, with its secrets, and live is ready", async () => {
  const root = template();
  const g = git({ tags: `${HEAD}\trefs/tags/v0.0.9\n${HEAD}\trefs/tags/v0.1.0\n` });
  const d = door();
  const w = web();
  const live = deployer();
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: g.exec, boundedExec: d.boundedExec, invoke: live.invoke, http: w.http, control, wait: async () => {} });
  assert.deepEqual(
    r.items.map((i) => [i.name, i.ready]),
    [["setup", true], ["check homes", true], ["live checks", true], ["deploy declared", true], ["release", true], ["secrets", true], ["deploy works", true]],
    r.items.map((i) => `${i.name}: ${i.say}`).join("\n"),
  );
  assert.equal(readinessRefusal([r]), undefined);
  assert.ok(d.ran.includes("python3 -m compileall -q app"), "the declared build was proved on the copy");
  assert.match(
    item(r, "setup").say,
    /the declared build \(python3 -m compileall -q app\) passes; that is not the image: the image is built, and its tests run, only by the platform's deploy/,
  );
  assert.doesNotMatch(item(r, "setup").say, /product build/, "a template's declared build is not said to build the product");
  assert.ok(g.calls.some((c) => /^git worktree add --detach .* a{40}$/.test(c)), "the setup ran on a copy of HEAD");
  assert.ok(g.calls.some((c) => /^git worktree remove --force /.test(c)), "and the copy was removed");
  assert.match(item(r, "check homes").say, /tests\/main_AC-1_test\.py/);
  assert.deepEqual(live.ran.map((x) => x.command), ["./deploy.sh"]);
  assert.deepEqual(live.ran[0].env, { THINKUBE_CONTROL_URL: "https://control.example.com", THINKUBE_API_TOKEN: "tok" }, "the deploy is told how to reach control");
  assert.ok(w.asked.includes("https://svc.example.com/health"), "the deployed health path was asked");
  assert.equal(fs.readFileSync(path.join(g.state.common, "tandem", "deployed"), "utf8").trim(), HEAD, "the deployed commit is recorded in git's common directory");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".tandem", "setup.json"), "utf8")).deployedAt, undefined, "and nothing is written into the tracked tree");
  assert.deepEqual(readinessNow(HOME, root, () => HEAD), r, "the answer is kept for whoever reads it next");

  // The same tree asked again: neither the setup nor the deploy runs again.
  const doorRuns = d.ran.length;
  const again = await checkReadiness({ repoRoot: root, home: HOME, exec: g.exec, boundedExec: d.boundedExec, invoke: live.invoke, http: w.http, control, wait: async () => {} });
  assert.deepEqual(again, r);
  assert.equal(d.ran.length, doorRuns, "the door did not run again");
  assert.equal(live.ran.length, 1, "nothing was deployed again");
});

test("a setup that does not hold on a clean copy is not ready, in the door's words", async () => {
  const root = template();
  const r = await checkReadiness({
    repoRoot: root,
    home: HOME,
    exec: git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` }).exec,
    boundedExec: door({ cmd: "python3 -m compileall -q app", output: "SyntaxError: invalid syntax (main.py, line 3)" }).boundedExec,
    invoke: deployer().invoke,
    http: web().http,
    control,
    wait: async () => {},
  });
  const setup = item(r, "setup");
  assert.equal(setup.ready, false);
  assert.match(setup.say, /product build \(python3 -m compileall -q app\) fails/);
  assert.match(setup.say, /SyntaxError: invalid syntax/);
  assert.match(readinessRefusal([r]) ?? "", /^not ready to sign — setup: /);
});

test("a check that would be minted where the repository runs no test is not ready, naming the path and the test roots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-plain-"));
  const r = await checkReadiness({
    repoRoot: root,
    home: HOME,
    exec: git({ files: ["src/score.py", "web/view.test.ts", "web/view.ts"] }).exec,
    boundedExec: door().boundedExec,
  });
  const homes = item(r, "check homes");
  assert.equal(homes.ready, false, homes.say);
  assert.match(homes.say, /src\/score_AC-1_test\.py/);
  assert.match(homes.say, /its tests live under web/);
  assert.deepEqual(r.items.map((i) => i.name), ["setup", "check homes", "live checks"], "a repository that is not a template is asked nothing about deploys");
  assert.match(item(r, "live checks").say, /^does not apply/);
});

test("a template that declares no deploy is not ready, and its deploy is not tried", async () => {
  const root = template({ yaml: thinkubeYaml({ deploy: false }) });
  const live = deployer();
  const r = await checkReadiness({
    repoRoot: root,
    home: HOME,
    exec: git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` }).exec,
    boundedExec: door().boundedExec,
    invoke: live.invoke,
    http: web().http,
    control,
    wait: async () => {},
  });
  assert.equal(item(r, "deploy declared").ready, false);
  assert.match(item(r, "deploy declared").say, /does not declare `run`.* or `at`/);
  assert.match(item(r, "deploy works").say, /not tried while deploy declared is not ready/);
  assert.equal(live.ran.length, 0);
});

test("a release tag that is not the declared version is not ready, naming both", async () => {
  const root = template({ yaml: thinkubeYaml({ version: "0.1.0" }) });
  const r = await checkReadiness({
    repoRoot: root,
    home: HOME,
    exec: git({ tags: `${HEAD}\trefs/tags/v0.1.0\n${HEAD}\trefs/tags/v0.1.2\n${HEAD}\trefs/tags/latest\n` }).exec,
    boundedExec: door().boundedExec,
    invoke: deployer().invoke,
    http: web().http,
    control,
    wait: async () => {},
  });
  const release = item(r, "release");
  assert.equal(release.ready, false);
  assert.match(release.say, /newest release tag is v0\.1\.2, but thinkube\.yaml metadata\.version is 0\.1\.0/);

  const untagged = template();
  const none = await checkReadiness({ repoRoot: untagged, home: HOME, exec: git({ tags: "" }).exec, boundedExec: door().boundedExec, control, http: web().http });
  assert.match(item(none, "release").say, /origin has no vMAJOR\.MINOR\.PATCH tag — tag the release v0\.1\.0/);

  const unreachable = template();
  const failed = await checkReadiness({ repoRoot: unreachable, home: HOME, exec: git().exec, boundedExec: door().boundedExec, control, http: web().http });
  assert.equal(item(failed, "release").ready, false);
  assert.match(item(failed, "release").say, /could not read from remote repository/, "git's own words");
});

test("a secret the manifest declares and control does not hold is not ready; control out of reach is not ready either", async () => {
  const root = template({ secrets: ["DB_URL", "API_KEY"] });
  const r = await checkReadiness({
    repoRoot: root,
    home: HOME,
    exec: git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` }).exec,
    boundedExec: door().boundedExec,
    invoke: deployer().invoke,
    http: web({ secrets: ["DB_URL"] }).http,
    control,
    wait: async () => {},
  });
  assert.equal(item(r, "secrets").ready, false);
  assert.match(item(r, "secrets").say, /holds no secret named API_KEY/);

  const away = template();
  const out = await checkReadiness({
    repoRoot: away,
    home: HOME,
    exec: git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` }).exec,
    boundedExec: door().boundedExec,
    invoke: deployer().invoke,
    http: web().http,
    control: () => ({ reason: "no way to reach thinkube-control" }),
    wait: async () => {},
  });
  assert.equal(item(out, "secrets").ready, false);
  assert.match(item(out, "secrets").say, /cannot be asked whether DB_URL exist: no way to reach thinkube-control/);
});

test("a deploy that fails is not ready in its own words; one already recorded for HEAD is only asked", async () => {
  const root = template();
  const broken = deployer("Error: release v0.1.0 not found in the catalog");
  const r = await checkReadiness({
    repoRoot: root,
    home: HOME,
    exec: git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` }).exec,
    boundedExec: door().boundedExec,
    invoke: broken.invoke,
    http: web().http,
    control,
    wait: async () => {},
  });
  assert.equal(item(r, "deploy works").ready, false);
  assert.match(item(r, "deploy works").say, /release v0\.1\.0 not found in the catalog/);

  const deployed = template({ facts: { provision: "", prepare: "", runOne: "./run_tests.sh <file>" } });
  const recorded = git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` });
  fs.mkdirSync(path.join(recorded.state.common, "tandem"));
  fs.writeFileSync(path.join(recorded.state.common, "tandem", "deployed"), `${HEAD}\n`);
  const live = deployer();
  const w = web({ health: 503 });
  let waits = 0;
  const sick = await checkReadiness({
    repoRoot: deployed,
    home: HOME,
    exec: recorded.exec,
    boundedExec: door().boundedExec,
    invoke: live.invoke,
    http: w.http,
    control,
    wait: async () => {
      waits++;
    },
  });
  assert.equal(live.ran.length, 0, "HEAD is already deployed, so nothing is deployed again");
  assert.equal(item(sick, "deploy works").ready, false);
  assert.match(item(sick, "deploy works").say, /https:\/\/svc\.example\.com\/health did not answer 2xx within 5 minutes — last, it answered 503/);
  assert.ok(waits > 0, "the health path was asked again between waits");
});

test("the commit recorded is the one the deploy left, and asking again at that HEAD deploys nothing", async () => {
  const RELEASE = "d".repeat(40);
  const root = template();
  const g = git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` });
  const live = deployer(undefined, { state: g.state, to: RELEASE });
  const ask = () =>
    checkReadiness({ repoRoot: root, home: HOME, exec: g.exec, boundedExec: door().boundedExec, invoke: live.invoke, http: web().http, control, wait: async () => {} });
  const first = await ask();
  assert.equal(item(first, "deploy works").ready, true, item(first, "deploy works").say);
  assert.match(item(first, "deploy works").say, /deployed dddddddd \(the deploy moved HEAD from aaaaaaaa\)/);
  assert.equal(fs.readFileSync(path.join(g.state.common, "tandem", "deployed"), "utf8").trim(), RELEASE, "HEAD after the deploy is recorded, not before");
  assert.equal(live.ran.length, 1);

  // The release commit is a new HEAD, so the tree is asked again — and its
  // deploy is not run again, because that commit is the one recorded.
  const second = await ask();
  assert.equal(second.head, RELEASE);
  assert.equal(item(second, "deploy works").ready, true);
  assert.match(item(second, "deploy works").say, /^already deployed dddddddd/);
  assert.equal(live.ran.length, 1, "nothing was deployed again, so the version is not raised again");
});

/** A backend and a front end built from the whole repository, whose module
 *  screens live in the backend's tree, beside a documentation linter that
 *  belongs to neither. */
const SPLIT = [
  "backend/app/main.py",
  "backend/app/config.py",
  "backend/app/modules/agenda/service.py",
  "backend/app/modules/agenda/frontend/pages/Agenda.vue",
  "backend/tests/conftest.py",
  "backend/tests/test_main.py",
  "frontend/app/app.vue",
  "frontend/tests/utils/format.test.ts",
  "scripts/check_docs_layout.py",
  "thinkube.yaml",
];

const SPLIT_YAML = [
  "apiVersion: thinkube.io/v1",
  "kind: ThinkubeDeployment",
  "spec:",
  "  containers:",
  "    - name: backend",
  "      build: ./backend",
  "    - name: frontend",
  "      build: .",
  "",
].join("\n");

test("a repository that declares parts is judged by code inside them, not by a script outside every part", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-split-"));
  fs.writeFileSync(path.join(root, "thinkube.yaml"), SPLIT_YAML);
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: git({ files: SPLIT }).exec, boundedExec: door().boundedExec });
  const homes = item(r, "check homes");
  assert.equal(homes.ready, true, homes.say);
  assert.match(homes.say, /a check for backend\/app\/config\.py is minted at backend\/tests\/config_AC-1_test\.py/);
});

test("with no thinkube.yaml the whole repository is read, as before", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-split-plain-"));
  const r = await checkReadiness({
    repoRoot: root,
    home: HOME,
    exec: git({ files: SPLIT.filter((f) => f !== "thinkube.yaml") }).exec,
    boundedExec: door().boundedExec,
  });
  const homes = item(r, "check homes");
  assert.equal(homes.ready, false, homes.say);
  assert.match(homes.say, /a check for scripts\/check_docs_layout\.py would be minted at scripts\/check_docs_layout_AC-1_test\.py/);
});

test("a container built from \".\" that says how one test runs is the command the door proves, over a remembered one", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-root-built-"));
  fs.writeFileSync(
    path.join(root, "thinkube.yaml"),
    [
      "apiVersion: thinkube.io/v1",
      "kind: ThinkubeDeployment",
      "spec:",
      "  containers:",
      "    - name: db",
      "      build: .",
      "      test:",
      "        enabled: true",
      '        command: "./run_tests.sh"',
      '        one: "./run_tests.sh <file>"',
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(root, ".tandem"));
  fs.writeFileSync(path.join(root, ".tandem", "setup.json"), JSON.stringify({ runOne: "pytest <file>", suite: "pytest -q" }));
  const d = door();
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: git().exec, boundedExec: d.boundedExec });
  const setup = item(r, "setup");
  assert.equal(setup.ready, true, setup.say);
  assert.match(setup.say, /one test runs with: \.\/run_tests\.sh <file>/);
  assert.ok(d.ran.includes("./run_tests.sh tests/test_main.py"), d.ran.join("\n"));
  assert.ok(d.ran.includes("./run_tests.sh"), "the declared suite is proved");
  assert.ok(!d.ran.includes("pytest -q"), "the remembered suite gives way to the declared one");
  const homes = item(r, "check homes");
  assert.equal(homes.ready, true, homes.say);
});

test("a repository that is not a template says its declared build builds the product", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-plain-"));
  fs.mkdirSync(path.join(root, ".tandem"));
  fs.writeFileSync(
    path.join(root, ".tandem", "setup.json"),
    JSON.stringify({ provision: "pip install -r requirements.txt", prepare: "", runOne: "./run_tests.sh <file>", suite: "./run_tests.sh", build: "python3 -m compileall -q app" }),
  );
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: git().exec, boundedExec: door().boundedExec });
  const setup = item(r, "setup");
  assert.equal(setup.ready, true, setup.say);
  assert.match(setup.say, /the product build \(python3 -m compileall -q app\) builds as shipped/);
  assert.doesNotMatch(setup.say, /image/);
});

test("an answer kept by one process is read by a fresh one for the same checkout and HEAD, and not for another HEAD", async () => {
  const home = { storeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-store-")), repoId: "svc-abc123" };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-kept-"));
  const g = git();
  const d = door();
  /** Each answer given makes one clean copy of HEAD. */
  const copies = () => g.calls.filter((c) => c.startsWith("git worktree add")).length;
  const r = await checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d.boundedExec });
  assert.equal(copies(), 1);
  const kept = fs.readdirSync(path.join(home.storeRoot, "spaces", home.repoId));
  assert.equal(kept.length, 1, kept.join(", "));
  assert.match(kept[0], /^readiness-[0-9a-f]{64}\.json$/, "kept beside the repository's spaces");

  // A fresh instance of the module holds nothing in memory: what it reads
  // comes from the store.
  delete require.cache[require.resolve("./readiness")];
  const fresh = require("./readiness") as typeof import("./readiness");
  assert.deepEqual(fresh.readinessNow(home, root, () => HEAD), r);
  assert.equal(fresh.readinessNow(home, root, () => "b".repeat(40)), undefined, "another HEAD has no answer");
  assert.equal(fresh.readinessNow({ ...home, repoId: "other-123456" }, root, () => HEAD), undefined, "another repository has none");

  const again = await fresh.checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d.boundedExec });
  assert.deepEqual(again, r);
  assert.equal(copies(), 1, "the fresh instance ran nothing for a tree already answered");

  g.state.head = "b".repeat(40);
  const moved = await fresh.checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d.boundedExec });
  assert.equal(moved.head, "b".repeat(40));
  assert.equal(copies(), 2, "a new HEAD is a new question");
  assert.deepEqual(fresh.readinessNow(home, root, () => "b".repeat(40)), moved);
});

test("a kept answer reuses what the tree decided and asks again what depends on the platform", async () => {
  const home = { storeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-reask-")), repoId: "svc-reask" };
  const root = template();
  const g = git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` });
  const d = door();
  const down = { http: async () => new Response("", { status: 503 }) };
  const first = await checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d.boundedExec, invoke: deployer().invoke, http: down.http, control, wait: async () => {} });
  assert.match(item(first, "secrets").say, /answered 503/);
  assert.equal(item(first, "setup").ready, true);
  const setupRuns = d.ran.length;

  const live = deployer();
  const again = await checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d.boundedExec, invoke: live.invoke, http: web().http, control, wait: async () => {} });
  assert.equal(item(again, "secrets").ready, true, item(again, "secrets").say);
  assert.equal(item(again, "deploy works").ready, true, item(again, "deploy works").say);
  assert.equal(d.ran.length, setupRuns, "the setup the tree decided is not run again");

  const third = await checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d.boundedExec, invoke: live.invoke, http: down.http, control, wait: async () => {} });
  assert.equal(third.at, again.at, "an answer with nothing to ask again is kept whole");
});

test("a setup whose check could not run is asked again", async () => {
  const home = { storeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-unchecked-")), repoId: "svc-unchecked" };
  const root = template();
  const g = git({ tags: `${HEAD}\trefs/tags/v0.1.0\n` });
  let broken = true;
  const flaky = {
    ran: [] as string[],
    boundedExec: async (cmd: string) => {
      flaky.ran.push(cmd);
      if (broken) throw new Error("the door could not start a shell");
      return { code: 0, output: "1 passed" };
    },
  };
  const args = { repoRoot: root, home, exec: g.exec, boundedExec: flaky.boundedExec, invoke: deployer().invoke, http: web().http, control, wait: async () => {} };
  const first = await checkReadiness(args);
  assert.equal(item(first, "setup").ready, false);
  assert.match(item(first, "setup").say, /^could not be checked: /);
  broken = false;
  const again = await checkReadiness(args);
  assert.equal(item(again, "setup").ready, true, item(again, "setup").say);
});

test("readiness proves the setup the run will work with, and does not reuse an answer proved on another", async () => {
  const home = { storeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-reading-")), repoId: "svc-reading" };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-readiness-reading-repo-"));
  const g = git();
  const reading = { provision: "cd web && npm ci", prepare: "", runOne: "./run_tests.sh <file>", build: "cd web && npm run build" };
  const d = door({ cmd: "cd web && npm run build", output: "FATAL ERROR: Reached heap limit Allocation failed" });
  const first = await checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d.boundedExec, reading });
  const setup = item(first, "setup");
  assert.equal(setup.ready, false, "the reading's build is proved, as the run will prove it");
  assert.match(setup.say, /cd web && npm run build/);
  assert.deepEqual(first.reading, reading);

  const fixed = { ...reading, build: "cd web && NODE_OPTIONS=--max-old-space-size=6144 npm run build" };
  const d2 = door();
  const again = await checkReadiness({ repoRoot: root, home, exec: g.exec, boundedExec: d2.boundedExec, reading: fixed });
  assert.ok(d2.ran.includes(fixed.build), "a different setup is proved again, not read from the kept answer");
  assert.equal(item(again, "setup").ready, true, item(again, "setup").say);
});

/**
 * A repository that names where it answers has promises only that service
 * can settle; its live checks are what settle them, so they must be
 * declared, and kept where the unit suite never collects them.
 */
test("live checks: ready when declared outside the unit suite, saying where they are minted and how they run", async () => {
  const root = template();
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: git().exec, boundedExec: door().boundedExec, control, http: web().http });
  const live = item(r, "live checks");
  assert.equal(live.ready, true, live.say);
  assert.match(live.say, /minted under live \(made by the first one\) and run one at a time with: python3 -m pytest -q <file>, against https:\/\/svc\.example\.com\//);
});

test("live checks: a repository with an address and no live declaration is not ready, saying exactly what to declare", async () => {
  const root = template({ yaml: thinkubeYaml({ live: [] }) });
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: git().exec, boundedExec: door().boundedExec, control, http: web().http });
  const live = item(r, "live checks");
  assert.equal(live.ready, false);
  assert.match(live.say, /spec\.deploy declares no `live` — declare `live\.home`.*and `live\.one`/);
  assert.match(readinessRefusal([r]) ?? "", /live checks: /);
});

test("live checks: a home inside the unit suite's test directory is not ready, naming why", async () => {
  const root = template({ yaml: thinkubeYaml({ live: ["    live:", "      home: tests/live", '      one: "pytest <file>"'] }) });
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: git().exec, boundedExec: door().boundedExec, control, http: web().http });
  const live = item(r, "live checks");
  assert.equal(live.ready, false);
  assert.match(live.say, /live\.home `tests\/live` is inside `tests`, where the unit suite's tests live \(tests\/test_main\.py\)/);
});

test("live checks: a declaration missing `one` is not ready, naming it", async () => {
  const root = template({ yaml: thinkubeYaml({ live: ["    live:", "      home: live"] }) });
  const r = await checkReadiness({ repoRoot: root, home: HOME, exec: git().exec, boundedExec: door().boundedExec, control, http: web().http });
  assert.equal(item(r, "live checks").ready, false);
  assert.match(item(r, "live checks").say, /spec\.deploy\.live declares no `one`/);
});
