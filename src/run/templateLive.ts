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
 * deploy that failed judged the work only when words show a runner or a
 * compiler judging (src/run/harvest.ts stepJudged), the rule an app's
 * pipeline is read by. The deploy's own output names the build workflow
 * that failed and its steps, never their output, so the log of each
 * failed step is read from thinkube-control and judged; the repair works
 * from it. A log Control does not give leaves the refusal unjudged, in
 * Control's words. Words that judge nothing mean it could not run, and
 * nothing is repaired for it. A health path that does not answer is a
 * deploy that did not go live. Not tried, for want of a declaration, is
 * unjudged.
 *
 * The commit the deploy leaves is recorded as deployed, so Accept, which
 * settles the same promises, asks it again and does not deploy it twice.
 */
import type { Delivery } from "../core/schema";
import { controlReachedBy, type Http } from "../hostui/templateCore";
import type { Went } from "./goingLive";
import { stampByValidation, stepJudged, validateTemplate, type Validation } from "./harvest";
import { namedFiles } from "./live";
import { liveSuiteDeclared } from "./liveSuite";
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
  // The logs of the failed build steps, when the deploy's output named a
  // failed build workflow and Control gave them.
  let stepLogs = "";
  return {
    goLive: async () => {
      last = await validateTemplate(a);
      stepLogs = "";
      if (last.ok) return { live: true };
      if (last.stage === "health") return { live: false, why: last.why };
      if (last.stage === "deploy" && stepJudged(last.why).judged) return { live: false, why: last.why };
      const workflow = last.stage === "deploy" ? failedWorkflowOf(last.why) : undefined;
      if (workflow) {
        const read = await failedStepLogs({
          workflow,
          control: a.control ?? controlReachedBy,
          http: a.http ?? fetch,
        });
        if ("refused" in read) {
          const why = `${last.why}\nthe log of the failed build ${workflow} could not be read: ${read.refused}`;
          last = { ...last, why };
          return { live: false, unjudged: true, why };
        }
        stepLogs = read.log;
        if (stepJudged(read.log).judged) return { live: false, why: last.why };
      }
      return { live: false, unjudged: true, why: last.why };
    },
    whyItFailed: async () => {
      if (!last || last.ok) throw new Error("the validation deployment has not refused anything to repair");
      const evidence = stepLogs ? `${last.why}\n${stepLogs}` : last.why;
      return { evidence, files: namedFiles(evidence, a.repoRoot) };
    },
    settle: async (d) => {
      if (!last) throw new Error("the validation deployment has not run, so there is nothing to settle");
      return stampByValidation(d, last, new Date().toISOString(), !!liveSuiteDeclared(a.repoRoot));
    },
  };
}

/**
 * The build workflow a failed deploy names: thinkube-control's deploy
 * prints the workflow's Argo address (`/workflows/argo/<name>`) and ends
 * with `Workflow <name> failed`. Nothing when it names none.
 */
export function failedWorkflowOf(words: string): string | undefined {
  const m =
    /\/workflows\/argo\/([a-z0-9][a-z0-9.-]*[a-z0-9])/.exec(words) ?? /\bWorkflow ([a-z0-9][a-z0-9.-]*[a-z0-9]) failed\b/.exec(words);
  return m?.[1];
}

/** How many lines of a failed step's log are read: a test step's summary
 *  is at its end. */
const STEP_LOG_LINES = 2000;

/**
 * The log of every failed step of a build workflow, from thinkube-control's
 * pipeline API: the workflow's stages, then each failed stage's log. A
 * refusal says what Control answered, in its words.
 */
export async function failedStepLogs(a: {
  workflow: string;
  control: ReachControl;
  http: Http;
}): Promise<{ log: string } | { refused: string }> {
  const auth = a.control();
  if ("reason" in auth) return { refused: auth.reason };
  const ask = async (route: string): Promise<{ body: unknown } | { refused: string }> => {
    const url = `${auth.base}/api/v1/cicd/${route}`;
    let res: Response;
    try {
      res = await a.http(url, { headers: { Authorization: `Bearer ${auth.token}` } });
    } catch (e) {
      return { refused: `GET ${url} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // A body that is not JSON is Control's answer as it stands.
      }
      return { refused: `Control answered ${res.status} to GET ${url}: ${detail.slice(0, 500)}` };
    }
    try {
      return { body: JSON.parse(text) as unknown };
    } catch {
      return { refused: `Control answered GET ${url} with a body that is not JSON: ${text.slice(0, 300)}` };
    }
  };
  const pipeline = await ask(`pipelines/${encodeURIComponent(a.workflow)}`);
  if ("refused" in pipeline) return pipeline;
  const stages = ((pipeline.body as { stages?: { stageName?: string; status?: string; podName?: string }[] }).stages ?? [])
    .filter((s) => /fail|error/i.test(s.status ?? "") && s.podName);
  if (!stages.length) return { refused: `Control lists no failed step of ${a.workflow} with a log` };
  const parts: string[] = [];
  for (const s of stages) {
    const read = await ask(
      `pipelines/${encodeURIComponent(a.workflow)}/logs/${encodeURIComponent(s.podName!)}?tail_lines=${STEP_LOG_LINES}`,
    );
    if ("refused" in read) return read;
    const logs = (read.body as { logs?: unknown }).logs;
    if (typeof logs !== "string")
      return { refused: `Control's answer for the log of ${s.stageName ?? s.podName} carries no \`logs\`` };
    parts.push(`── ${s.stageName ?? s.podName} (${a.workflow}) ──\n${logs}`);
  }
  return { log: parts.join("\n") };
}
