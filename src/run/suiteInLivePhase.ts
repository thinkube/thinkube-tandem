/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repository suite that the platform's pipeline judges in the live phase.
 *
 * Some repositories have their whole suite run by the step that makes the
 * work live: an app's gitops pipeline, and a template's declared deploy,
 * run the declared tests before they build, and refuse the work when a
 * test fails. For those, the closing gate does not run the suite in the
 * IDE. Its "repo suite" proof is pending at the gate and is settled by the
 * live phase: green when the work went live, red in the pipeline's words
 * when the refusal shows a test runner or a compiler judging
 * (src/run/harvest.ts stepJudged), and still pending otherwise.
 *
 * The answer here mirrors how src/run/dispatch.ts makes work live: an app
 * waits for the pipeline at the address it declares; a template runs the
 * deploy it declares. A repository with no such address goes through no
 * live phase, so its suite runs at the gate.
 */
import type { Delivery, Proof } from "../core/schema";
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { stepJudged } from "./harvest";
import { deployedAddress } from "./live";
import { downstreamOf } from "./survey";

/** The source named on the pending "repo suite" proof. */
export const SUITE_IN_LIVE_PHASE = "the platform pipeline's test step, in the live phase";

/** The proof's label, the same one the gate gives a suite it runs. */
const LABEL = "repo suite";

/**
 * Who runs this repository's suite as part of going live, or nothing when
 * the suite is not run there.
 */
export function suiteRunInLivePhase(repoRoot: string): string | undefined {
  if (!deployedAddress(repoRoot)) return undefined;
  const downstream = downstreamOf(repoRoot);
  if (downstream === "gitops-app") return "the app's gitops pipeline";
  if (downstream !== "template") return undefined;
  const read = thinkubeDeclaration(repoRoot);
  return read && "declared" in read && read.declared.deploy?.run.length
    ? "the template's declared deploy"
    : undefined;
}

/** The gate's "repo suite" proof, left for the live phase to settle. */
export function suiteLeftToLivePhase(who: string): Proof {
  return {
    kind: "suite",
    label: LABEL,
    verdict: "pending",
    settledBy: SUITE_IN_LIVE_PHASE,
    ref: `not run in the IDE — ${who} runs the suite before it builds, in the live phase`,
  };
}

/** Whether a proof is the suite the live phase settles. */
export function isSuiteInLivePhase(p: Proof): boolean {
  return p.kind === "suite" && p.settledBy === SUITE_IN_LIVE_PHASE;
}

/** What the live phase answered about the work, for the suite proof. */
export type LivePhaseAnswer =
  | { live: true }
  | { live: false; refusal: string }
  | { live: false; notJudged: string };

/**
 * The delivery with its pending suite proof settled by the live phase.
 * A delivery with no such proof is returned unchanged.
 */
export function settleSuiteInLivePhase(d: Delivery, answer: LivePhaseAnswer): Delivery {
  if (!d.proofs.some(isSuiteInLivePhase)) return d;
  const settled = (p: Proof): Proof => {
    if (answer.live)
      return {
        ...p,
        verdict: "green",
        ref: `the work went live, so the pipeline's test step passed before the build`,
      };
    if ("refusal" in answer) {
      const read = stepJudged(answer.refusal);
      if (read.judged)
        return {
          ...p,
          verdict: "red",
          ref: `the pipeline's test step refused the work: ${read.said}\n${answer.refusal.trim().split("\n").slice(-20).join("\n")}`.slice(0, 1200),
        };
      return { ...p, verdict: "pending", ref: `still pending — the refusal shows no test judging: ${read.said}`.slice(0, 400) };
    }
    return { ...p, verdict: "pending", ref: `still pending — ${answer.notJudged}`.slice(0, 400) };
  };
  return { ...d, proofs: d.proofs.map((p) => (isSuiteInLivePhase(p) ? settled(p) : p)) };
}
