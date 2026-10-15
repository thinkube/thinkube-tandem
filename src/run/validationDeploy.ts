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
 * A commit already recorded as deployed is not deployed again: the deploy
 * takes minutes, and asking twice about the same tree must not pay twice.
 * Its health is still asked, because a thing deployed once may be gone.
 */
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { controlReachedBy, type ControlAuth, type Http } from "../hostui/templateCore";
import { deployedCommitOf, rememberDeployed } from "./facts";
import { makeLive, type Invoke } from "./makeLive";
import type { Exec } from "./oracle";
import { waitOrStop } from "./waiting";

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

export type Validated =
  /** It went live and its health path answered. `deployed` is false when
   *  this commit was already recorded as deployed and nothing was run. */
  | { ok: true; at: string; url: string; deployed: boolean }
  /** It was not tried: the repository does not declare what is needed. */
  | { ok: false; stage: "declaration"; why: string }
  /** It was tried and did not go live, in the deploy's or the probe's words. */
  | { ok: false; stage: "deploy" | "health"; why: string };

export async function validationDeploy(a: {
  repoRoot: string;
  /** The commit being judged. */
  head: string;
  invoke?: Invoke;
  http?: Http;
  control?: ReachControl;
  wait?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
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

  const already = deployedCommitOf(a.repoRoot) === a.head;
  if (already) a.log?.(`${a.head.slice(0, 8)} is already deployed — asking ${url} only`);
  else {
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
  }

  const get = a.http ?? fetch;
  const wait = a.wait ?? ((ms: number) => waitOrStop(ms));
  let last = "it was not asked";
  for (let i = 0; i < HEALTH_TRIES; i++) {
    let status: number | undefined;
    try {
      status = (await get(url)).status;
    } catch (e) {
      last = `it could not be reached: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (status !== undefined && status >= 200 && status < 300) {
      rememberDeployed(a.repoRoot, a.head);
      return { ok: true, at: deploy.at, url, deployed: !already };
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
