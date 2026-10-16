/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The cut's live checks, run against the deployed service once the work
 * is live.
 *
 * A criterion only the running service can answer — a service returning
 * what another service wrote, a deployed parser answering real markup — is
 * proved by a check the tester wrote against the service's public API and
 * minted under the repository's live home (`spec.deploy.live.home`). The
 * gate never runs it: the unit gate must not reach the network. It runs
 * here, after the deploy, one at a time with the repository's own command
 * (`spec.deploy.live.one`), in the delivery's tree, told where the service
 * answers (`TANDEM_LIVE_URL`) and how to reach thinkube-control
 * (`THINKUBE_CONTROL_URL`, `THINKUBE_API_TOKEN`).
 *
 * Each check's exit settles its criterion: green or red with the end of
 * what it printed, or unjudged with the reason it could not run. A check
 * that could not run says nothing about the work, so it never counts
 * against it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Change, Delivery, Proof, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import type { Invoke } from "./makeLive";
import { stepJudged } from "./harvest";
import { aRunnerAnswered } from "./suiteCommand";
import type { ReachControl } from "./validationDeploy";
import type { LiveSuite } from "./liveSuite";

/** What a proof's ref starts with when a live check settled it. */
const LIVE_CHECK = "live check";

/** How much of a check's output its proof carries. */
const TAIL_CHARS = 600;

/** One live check of the cut: the file, and the criterion it proves. */
export interface LiveCheck {
  path: string;
  criterionId: string;
  /** The criterion's own words. */
  label: string;
  /** The promise the criterion belongs to, by sentence. */
  promise: string;
}

/** A test unit the adapter made for a criterion the running product answers. */
export function isLiveCheckUnit(u: object): boolean {
  return (u as { live?: unknown }).live === true;
}

/**
 * The live checks a plan holds: every live test unit's file, with the
 * criterion it was written from. A test unit's place among its slice's
 * test units is its criterion's place in `criterionIds`.
 */
export function liveChecksOf(slices: readonly SliceForDag[], space: Space): LiveCheck[] {
  const out: LiveCheck[] = [];
  for (const s of slices) {
    const ids = (s as { criterionIds?: string[] }).criterionIds ?? [];
    s.workUnits
      .filter((u) => u.role === "test")
      .forEach((u, k) => {
        const id = ids[k];
        const file = u.footprint[0];
        if (!isLiveCheckUnit(u) || !id || !file) return;
        const n: Change | undefined = space.nodes.find((x) => x.acceptance.some((c) => c.id === id));
        const c = n?.acceptance.find((x) => x.id === id);
        if (!n || !c) return;
        out.push({ path: file, criterionId: id, label: c.text, promise: n.sentence });
      });
  }
  return out;
}

/** The end of what a check printed. */
function tailOf(out: string): string {
  const t = out.trim();
  return t.length > TAIL_CHARS ? `…${t.slice(-TAIL_CHARS)}` : t;
}

/**
 * What one live check's exit says about its criterion.
 *
 * Exit 0 is green. A non-zero exit is red only when a runner answered —
 * its words show a test that ran and failed; otherwise the command did not
 * run a check at all (not found, nothing collected) and it is unjudged.
 */
export function liveVerdict(code: number | null, out: string): "green" | "red" | "unjudged" {
  if (code === 0) return "green";
  return aRunnerAnswered(code, out) || stepJudged(out).judged ? "red" : "unjudged";
}

/**
 * Run each live check with the repository's command and settle its
 * criterion from the exit. A check whose file is not in the tree, or that
 * cannot be given control's address and token, is unjudged and says why.
 */
export async function runLiveChecks(a: {
  checks: readonly LiveCheck[];
  /** `spec.deploy.live.one`, with `<file>` for a check's path. */
  one: string;
  /** The delivery's tree: the commands run here, and the paths are relative to it. */
  tree: string;
  /** Where the deployed service answers (`spec.deploy.at`). */
  at: string;
  control: ReachControl;
  run: Invoke;
  log: (line: string) => void;
}): Promise<Proof[]> {
  const reach = a.control();
  const proof = (c: LiveCheck, verdict: Proof["verdict"], said: string): Proof => ({
    kind: "probe",
    label: c.label,
    verdict,
    ref: `${LIVE_CHECK} ${c.path}: ${said}`,
    criterionId: c.criterionId,
  });
  const out: Proof[] = [];
  for (const c of a.checks) {
    if ("reason" in reach) {
      out.push(proof(c, "unjudged", `not run — thinkube-control cannot be reached for its address and token: ${reach.reason}`));
      continue;
    }
    if (!fs.existsSync(path.join(a.tree, c.path))) {
      out.push(proof(c, "unjudged", "not run — the check is not in the delivered tree"));
      continue;
    }
    const command = a.one.replace(/<file>/g, c.path);
    a.log(`live check ${c.path}: ${command}`);
    const r = await a.run(command, a.tree, {
      TANDEM_LIVE_URL: a.at,
      THINKUBE_CONTROL_URL: reach.base,
      THINKUBE_API_TOKEN: reach.token,
    });
    const verdict = liveVerdict(r.code, r.out);
    const tail = tailOf(r.out) || `exit ${r.code ?? "none"}, and it printed nothing`;
    a.log(`live check ${c.path}: ${verdict}`);
    out.push(
      proof(
        c,
        verdict,
        verdict === "unjudged" ? `could not run a check (exit ${r.code ?? "none"}) — ${tail}` : `exit ${r.code} — ${tail}`,
      ),
    );
  }
  return out;
}

/** The delivery with each live check's verdict in place of what its
 *  criterion held before: one answer per criterion, the newest. */
function settleByLiveChecks(d: Delivery, proofs: readonly Proof[]): Delivery {
  const settled = new Map(proofs.map((p) => [p.criterionId, p]));
  const kept = d.proofs.filter((p) => !p.criterionId || !settled.has(p.criterionId));
  const before = new Map(d.proofs.filter((p) => p.criterionId).map((p) => [p.criterionId, p]));
  return {
    ...d,
    proofs: [
      ...kept,
      ...proofs.map((p) => {
        const was = p.criterionId ? before.get(p.criterionId) : undefined;
        return was?.settledBy ? { ...p, settledBy: was.settledBy } : p;
      }),
    ],
  };
}

/**
 * The live phase's own judgement: the cut's live checks — or those of the
 * promises named by `only`, when a repair asks again — run against the
 * deployed service, and their verdicts settled on the delivery.
 */
export async function judgeByLiveChecks(a: {
  delivery: Delivery;
  checks: readonly LiveCheck[];
  only?: (promise: string) => boolean;
  suite: LiveSuite;
  tree: string;
  control: ReachControl;
  run: Invoke;
  log: (line: string) => void;
  doing: (line: string) => void;
}): Promise<Delivery> {
  const mine = a.only ? a.checks.filter((c) => a.only!(c.promise)) : a.checks;
  if (!mine.length) return a.delivery;
  a.doing(`running ${mine.length} live check(s) against ${a.suite.at}`);
  const proofs = await runLiveChecks({
    checks: mine,
    one: a.suite.one,
    tree: a.tree,
    at: a.suite.at,
    control: a.control,
    run: a.run,
    log: a.log,
  });
  return settleByLiveChecks(a.delivery, proofs);
}
