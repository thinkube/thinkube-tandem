/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Waiting until the new version is the one answering.
 *
 * A deploy that returns has started a rollout, not finished one: the old
 * pods answer at the address until the new ones are ready and the old ones
 * are gone, so a health path answers and a live check judges the previous
 * version. A template app runs as the Deployment `<app>-<container>` in
 * the namespace `<app>`; the deploy is live when that Deployment has a
 * revision it did not have before the deploy, the controller has seen its
 * newest spec, and every replica it runs is of that revision and
 * available — none of an older one is left.
 */
import { execFile } from "node:child_process";

/** What Kubernetes says of a Deployment's rollout. */
export interface DeploymentState {
  /** `deployment.kubernetes.io/revision`: raised by every new pod template;
   *  absent before the first rollout. */
  revision?: string;
  generation: number;
  observedGeneration: number;
  /** Replicas wanted. */
  replicas: number;
  /** Replicas running, of any revision. */
  current: number;
  /** Replicas of the newest revision. */
  updated: number;
  available: number;
}

/** A Deployment as Kubernetes holds it now; nothing when it does not
 *  exist. Any other failure to read it throws, in kubectl's words. */
export type ReadDeployment = (namespace: string, name: string) => Promise<DeploymentState | undefined>;

export const kubectlDeployment: ReadDeployment = (namespace, name) =>
  new Promise((resolve, reject) =>
    execFile(
      "kubectl",
      ["get", "deployment", name, "-n", namespace, "-o", "json"],
      { timeout: 30_000, maxBuffer: 8 << 20 },
      (err, out, errOut) => {
        if (err) {
          if (/\bNotFound\b|not found/.test(errOut)) return resolve(undefined);
          return reject(new Error(`kubectl could not read deployment ${namespace}/${name}: ${(errOut || err.message).trim()}`));
        }
        const d = JSON.parse(out) as {
          metadata?: { generation?: number; annotations?: Record<string, string> };
          spec?: { replicas?: number };
          status?: { observedGeneration?: number; replicas?: number; updatedReplicas?: number; availableReplicas?: number };
        };
        const revision = d.metadata?.annotations?.["deployment.kubernetes.io/revision"];
        resolve({
          ...(revision ? { revision } : {}),
          generation: d.metadata?.generation ?? 0,
          observedGeneration: d.status?.observedGeneration ?? 0,
          // Kubernetes omits a count that is zero, and defaults spec.replicas to 1.
          replicas: d.spec?.replicas ?? 1,
          current: d.status?.replicas ?? 0,
          updated: d.status?.updatedReplicas ?? 0,
          available: d.status?.availableReplicas ?? 0,
        });
      },
    ),
  );

/** Why the rollout of a new revision is not complete, or nothing when it is. */
export function notRolledOut(before: DeploymentState | undefined, now: DeploymentState | undefined): string | undefined {
  if (!now) return "the deployment does not exist yet";
  if (before && now.revision === before.revision)
    return `it is still at revision ${before.revision ?? "(none)"}, the one before the deploy`;
  if (now.observedGeneration < now.generation) return "the controller has not yet seen its newest spec";
  if (now.updated < now.replicas) return `${now.updated} of ${now.replicas} replica(s) run the new revision`;
  if (now.available < now.replicas) return `${now.available} of ${now.replicas} replica(s) are available`;
  if (now.current > now.updated) return `${now.current - now.updated} replica(s) of the previous revision still run`;
  return undefined;
}

/** How long a rollout is waited for, and how often it is asked. */
const ROLLOUT_TIMEOUT_MS = 10 * 60_000;
const ROLLOUT_EVERY_MS = 5_000;

/**
 * Wait until the Deployment has rolled out a revision other than `before`.
 * Bounded: past the timeout it answers the error, naming the Deployment
 * and what it was still waiting for; nothing when the rollout completed.
 * A Deployment that cannot be read throws, in kubectl's words.
 */
export async function waitForRollout(a: {
  namespace: string;
  name: string;
  /** The Deployment before the deploy; nothing when it did not exist. */
  before: DeploymentState | undefined;
  read: ReadDeployment;
  wait: (ms: number) => Promise<unknown>;
  now?: () => number;
  log?: (line: string) => void;
  timeoutMs?: number;
}): Promise<string | undefined> {
  const now = a.now ?? Date.now;
  const timeout = a.timeoutMs ?? ROLLOUT_TIMEOUT_MS;
  const until = now() + timeout;
  let said = "";
  for (;;) {
    const why = notRolledOut(a.before, await a.read(a.namespace, a.name));
    if (!why) {
      a.log?.(`the new revision of ${a.namespace}/${a.name} is the one serving`);
      return undefined;
    }
    if (why !== said) a.log?.(`waiting for the rollout of ${a.namespace}/${a.name}: ${why}`);
    said = why;
    if (now() >= until)
      return `the deployment ${a.namespace}/${a.name} did not finish rolling out the new revision within ${Math.round(timeout / 60_000)} minute(s) — last, ${why}`;
    await a.wait(ROLLOUT_EVERY_MS);
  }
}
