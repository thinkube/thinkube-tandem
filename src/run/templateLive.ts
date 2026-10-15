/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How a run makes a template live: by running its declared deploy.
 *
 * A push of a template builds nothing — no pipeline watches its
 * repository — so waiting for the platform to notice the push waits for
 * ever. A template is made live by the validation deployment its
 * `thinkube.yaml` declares (src/run/validationDeploy.ts): it releases,
 * deploys through thinkube-control, and is asked at its health path.
 *
 * What the deploy answered is said in the run's terms. Live is live. A
 * deploy that failed judged the work only when its own words show a
 * runner or a compiler judging (src/run/harvest.ts stepJudged), the rule
 * an app's pipeline is read by; otherwise it could not run, and nothing
 * is repaired for it. A health path that does not answer is a deploy that
 * did not go live. Not tried, for want of a declaration, is unjudged.
 *
 * The commit the deploy leaves is recorded as deployed, so Accept, which
 * settles the same promises, asks it again and does not deploy it twice.
 */
import type { Delivery } from "../core/schema";
import type { Http } from "../hostui/templateCore";
import type { Went } from "./goingLive";
import { stampByValidation, stepJudged, validateTemplate, type Validation } from "./harvest";
import { namedFiles } from "./live";
import type { Invoke } from "./makeLive";
import type { Exec } from "./oracle";
import type { ReachControl } from "./validationDeploy";

export function templateGoesLive(a: {
  repoRoot: string;
  exec: Exec;
  log: (line: string) => void;
  invoke?: Invoke;
  http?: Http;
  control?: ReachControl;
  wait?: (ms: number) => Promise<unknown>;
}): {
  goLive: () => Promise<Went>;
  whyItFailed: () => Promise<{ evidence: string; files: string[] }>;
  settle: (d: Delivery) => Promise<Delivery>;
} {
  let last: Validation | undefined;
  return {
    goLive: async () => {
      last = await validateTemplate(a);
      if (last.ok) return { live: true };
      if (last.stage === "health") return { live: false, why: last.why };
      if (last.stage === "deploy" && stepJudged(last.why).judged) return { live: false, why: last.why };
      return { live: false, unjudged: true, why: last.why };
    },
    whyItFailed: async () => {
      if (!last || last.ok) throw new Error("the validation deployment has not refused anything to repair");
      return { evidence: last.why, files: namedFiles(last.why, a.repoRoot) };
    },
    settle: async (d) => {
      if (!last) throw new Error("the validation deployment has not run, so there is nothing to settle");
      return stampByValidation(d, last, new Date().toISOString());
    },
  };
}
