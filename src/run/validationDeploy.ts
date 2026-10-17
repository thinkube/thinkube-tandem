/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A validation deployment: the repository's declared deploy, run for one
 * commit, and the deployed thing seen answering at its health path.
 *
 * A template is proved by deploying it through thinkube-control, and that
 * is the same act whether it is asked before anything is signed or after
 * the work is merged. The deploy is what the repository declares in
 * `thinkube.yaml` (`spec.deploy.run`, seen at `spec.deploy.at`); the
 * health path is its first container's `health`. Nothing here knows how
 * the deploy works.
 *
 * A deploy that returns has started a rollout, not finished it: the old
 * pods answer the health path until the new ones replace them. So after a
 * deploy, the app's Deployment (`<app>-<container>` in namespace `<app>`)
 * is waited for until a new revision has rolled out and none of the old
 * one runs (src/run/rollout.ts); only then is the health path asked.
 *
 * A commit already recorded as deployed is not deployed again: the deploy
 * takes minutes, and asking twice about the same tree must not pay twice.
 * Its health is still asked, because a thing deployed once may be gone.
 *
 * The commit recorded is HEAD as it stands AFTER the deploy: a template's
 * deploy commits and tags a release, so the commit it leaves is the one
 * the next question finds. The record lives in the repository's git common
 * directory — per repository, shared by its worktrees, never committed —
 * because a record in the tracked tree either moves HEAD when committed or
 * leaves the checkout dirty.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { controlReachedBy, type ControlAuth, type Http } from "../hostui/templateCore";
import { makeLive, type Invoke } from "./makeLive";
import { defaultExec, type Exec } from "./oracle";
import { waitOrStop } from "./waiting";
import { kubectlDeployment, waitForRollout, type ReadDeployment } from "./rollout";

/** How often the health path is asked, and how many times, before the
 *  deploy is judged not to have gone live: five minutes, which covers a
 *  scale-from-zero start. */
const HEALTH_TRIES = 30;
const HEALTH_EVERY_MS = 10_000;

export type ReachControl = () => ControlAuth | { reason: string };

/**
 * What a deploy's commands are told about thinkube-control: its address and
 * a token, in the two variables the platform's own scripts read. Absent
 * when control cannot be reached from here; the deploy then runs without
 * them and says so in its own words if it needs them.
 */
export function controlEnvOf(reach: ReachControl = controlReachedBy): Record<string, string> | undefined {
  const known = reach();
  return "reason" in known ? undefined : { THINKUBE_CONTROL_URL: known.base, THINKUBE_API_TOKEN: known.token };
}

/** The commit a tree's HEAD names. A repository git cannot read throws
 *  with git's own words. */
export async function headOf(repoRoot: string, exec: Exec): Promise<string> {
  const r = await exec("git", ["-C", repoRoot, "rev-parse", "HEAD"], repoRoot);
  const head = r.out.trim().split("\n")[0]?.trim() ?? "";
  if (r.code !== 0 || !/^[0-9a-f]{40}$/.test(head))
    throw new Error(`git could not name HEAD in ${repoRoot}: ${r.out.trim().slice(0, 300)}`);
  return head;
}

/** Where the deployed commit is recorded: `<git common dir>/tandem/deployed`. */
async function recordOf(repoRoot: string, exec: Exec): Promise<string> {
  const r = await exec("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], repoRoot);
  const dir = r.out.trim().split("\n")[0]?.trim() ?? "";
  if (r.code !== 0 || !dir)
    throw new Error(`git could not name the common directory of ${repoRoot}: ${r.out.trim().slice(0, 300)}`);
  return path.join(path.resolve(repoRoot, dir), "tandem", "deployed");
}

/** The commit last deployed here and seen answering, if one was. */
async function deployedCommitOf(repoRoot: string, exec: Exec): Promise<string | undefined> {
  const at = await recordOf(repoRoot, exec);
  return fs.existsSync(at) ? fs.readFileSync(at, "utf8").trim() || undefined : undefined;
}

/** Record the commit a deploy left live. A record that cannot be written
 *  throws: a deploy that is not remembered runs again, and the caller says why. */
async function rememberDeployed(repoRoot: string, commit: string, exec: Exec): Promise<void> {
  const at = await recordOf(repoRoot, exec);
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.writeFileSync(at, `${commit}\n`);
}

export type Validated =
  /** It went live and its health path answered. `deployed` is false when
   *  this commit was already recorded as deployed and nothing was run.
   *  `head` is the commit live now, the one recorded as deployed. */
  | { ok: true; at: string; url: string; deployed: boolean; head: string }
  /** It was not tried: the repository does not declare what is needed. */
  | { ok: false; stage: "declaration"; why: string }
  /** It was tried and did not go live, in the deploy's or the probe's words. */
  | { ok: false; stage: "deploy" | "health"; why: string };

export async function validationDeploy(a: {
  repoRoot: string;
  /** The commit being judged. */
  head: string;
  /** git: the common directory, and HEAD after the deploy. */
  exec?: Exec;
  invoke?: Invoke;
  http?: Http;
  control?: ReachControl;
  wait?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
  /** How the app's Deployment is read, to wait for its rollout. */
  readDeployment?: ReadDeployment;
}): Promise<Validated> {
  const read = thinkubeDeclaration(a.repoRoot);
  if (!read) return { ok: false, stage: "declaration", why: "the repository has no thinkube.yaml" };
  if ("unreadable" in read) return { ok: false, stage: "declaration", why: read.unreadable };
  const deploy = read.declared.deploy;
  if (!deploy?.run.length || !deploy.at)
    return {
      ok: false,
      stage: "declaration",
      why: "thinkube.yaml declares no spec.deploy with both `run` (how it is deployed) and `at` (where it answers)",
    };
  const health = read.declared.containers[0]?.health;
  if (!health)
    return {
      ok: false,
      stage: "declaration",
      why: "the first container in thinkube.yaml declares no `health` path, so nothing can show the deploy answering",
    };
  const url = `${deploy.at.replace(/\/+$/, "")}${health.startsWith("/") ? health : `/${health}`}`;

  const exec = a.exec ?? defaultExec;
  const wait = a.wait ?? ((ms: number) => waitOrStop(ms));
  const already = (await deployedCommitOf(a.repoRoot, exec)) === a.head;
  if (already) a.log?.(`${a.head.slice(0, 8)} is already deployed — asking ${url} only`);
  else {
    const app = read.declared.name;
    const container = read.declared.containers[0]?.name;
    if (!app || !container)
      return {
        ok: false,
        stage: "declaration",
        why: "thinkube.yaml declares no spec.deployment.name and first container name, so the Deployment that serves the new version cannot be named to wait for its rollout",
      };
    const deployment = { namespace: app, name: `${app}-${container}` };
    const readDeployment = a.readDeployment ?? kubectlDeployment;
    const before = await readDeployment(deployment.namespace, deployment.name);
    const env = controlEnvOf(a.control);
    if (!env) a.log?.("thinkube-control cannot be reached from here — the deploy runs without its address and token");
    const went = await makeLive({
      repoRoot: a.repoRoot,
      deploy,
      ...(a.invoke ? { invoke: a.invoke } : {}),
      ...(env ? { env } : {}),
      ...(a.log ? { log: a.log } : {}),
    });
    if (!went.live) return { ok: false, stage: "deploy", why: went.detail ?? "the deploy did not succeed" };
    // A rollout that never completes is a deploy that did not go live.
    const stuck = await waitForRollout({ ...deployment, before, read: readDeployment, wait, ...(a.log ? { log: a.log } : {}) });
    if (stuck) return { ok: false, stage: "health", why: stuck };
  }
  // What the deploy left: a release commit when it made one, the same
  // commit when nothing was deployed.
  const live = already ? a.head : await headOf(a.repoRoot, exec);

  const get = a.http ?? fetch;
  let last = "it was not asked";
  for (let i = 0; i < HEALTH_TRIES; i++) {
    let status: number | undefined;
    try {
      status = (await get(url)).status;
    } catch (e) {
      last = `it could not be reached: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (status !== undefined && status >= 200 && status < 300) {
      await rememberDeployed(a.repoRoot, live, exec);
      return { ok: true, at: deploy.at, url, deployed: !already, head: live };
    }
    if (status !== undefined) last = `it answered ${status}`;
    if (i < HEALTH_TRIES - 1) await wait(HEALTH_EVERY_MS);
  }
  return {
    ok: false,
    stage: "health",
    why: `${url} did not answer 2xx within ${(HEALTH_TRIES * HEALTH_EVERY_MS) / 60_000} minutes — last, ${last}`,
  };
}
