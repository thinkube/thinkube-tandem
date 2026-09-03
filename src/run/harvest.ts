/**
 * Bringing home the verdicts the merge set in motion.
 *
 * A delivery on this platform is not finished at the merge. For an app,
 * the push itself fires the pipeline — webhook, tests in the declared
 * image, Kaniko, Harbor, ArgoCD — and the answers to the promises marked
 * `settledBy` exist only there, afterwards. For a playbook component, the
 * answer is its own `18_test.yaml` run against the live cluster. For a
 * package, it is a person who installed it.
 *
 * Tandem drives none of that pipeline. It watches what its accept started,
 * and stamps what it learns onto the delivery's pending proofs — so a
 * promise is CLOSED when its settling point answered, not merely merged.
 *
 * Nothing here reports a machine failure as a verdict: a pipeline that
 * cannot be reached leaves the proof pending with the reason on it, and
 * says so. Only the settling point's own answer turns pending into green
 * or red.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Delivery, Proof } from "../core/schema";

/** The control API's base URL for a gitops app, from the repository's own
 *  remote: `git.<domain>` names the platform, `control.<domain>` runs the
 *  API. Evidence, not configuration. */
export function controlUrlOf(remote: string): string | undefined {
  const m = /^https?:\/\/(?:[^@/]+@)?git\.([^/]+)\//.exec(remote);
  return m ? `https://control.${m[1]}` : undefined;
}

/** Where the deployed app answers, from the same evidence: the platform
 *  gives an app its own name under the platform's domain. Derived rather
 *  than configured, so a look never drives a URL somebody typed. */
function deployedUrlOf(remote: string, app: string): string | undefined {
  const m = /^https?:\/\/(?:[^@/]+@)?git\.([^/]+)\//.exec(remote);
  return m && app ? `https://${app}.${m[1]}` : undefined;
}

/** The token the deployer installed for exactly this kind of call. */
function apiToken(home = process.env.HOME ?? "~"): string | undefined {
  try {
    const t = fs.readFileSync(path.join(home, ".thinkube", "api-token"), "utf8").trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export interface PipelineReading {
  /** The pipeline reached an end state. */
  settled: boolean;
  /** The run's own name, for reading a step's log. */
  id?: string;
  /** Terminal phase when settled: Succeeded, Failed, Error. */
  phase?: string;
  /** Per-stage names and statuses, test steps included. */
  stages: { name: string; status: string; said?: string; pod?: string }[];
  /** Why nothing could be read, when the machine could not reach it. */
  unreachable?: string;
}

type Http = (url: string, token: string) => Promise<unknown>;

const httpGet: Http = async (url, token) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as unknown;
};

/**
 * The newest pipeline run for an app, read from control — which reads the
 * Argo Workflow objects; nothing pushes results anywhere, so pull is the
 * only honest read.
 */
/** A moment, however the platform writes it: epoch seconds, epoch
 *  milliseconds, or a date. Comparing them as text put every run before
 *  every accept, and the answer was never found. */
function momentOf(v: unknown): number {
  if (typeof v === "number") return v > 1e11 ? v : v * 1000;
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(n) ? 0 : n;
}

/** The platform's own words for an outcome, in any case it writes them. */
const ENDED = ["succeeded", "failed", "error"];

export async function readPipeline(a: {
  controlUrl: string;
  app: string;
  /** Only runs started at or after this moment count — the accept's own
   *  push, not last week's. */
  since: string;
  token: string;
  http?: Http;
}): Promise<PipelineReading> {
  const get = a.http ?? httpGet;
  // The accept's push and the pipeline's start are two clocks: a run that
  // began a few seconds before the record was written is still this
  // accept's run.
  const since = momentOf(a.since) - 120_000;
  try {
    const list = (await get(`${a.controlUrl}/api/v1/cicd/pipelines`, a.token)) as {
      pipelines?: { id?: string; name?: string; appName?: string; status?: string; startedAt?: unknown }[];
    };
    const mine = (list.pipelines ?? [])
      .filter((p) => p.appName === a.app && momentOf(p.startedAt) >= since)
      .sort((x, y) => momentOf(y.startedAt) - momentOf(x.startedAt))[0];
    const id = mine?.id ?? mine?.name;
    if (!id)
      return { settled: false, stages: [], unreachable: `no pipeline for ${a.app} since ${a.since} yet` };
    const full = (await get(`${a.controlUrl}/api/v1/cicd/pipelines/${id}`, a.token)) as {
      status?: string;
      stages?: { name?: string; stageName?: string; component?: string; status?: string; errorMessage?: string; podName?: string }[];
    };
    const phase = full.status ?? mine?.status ?? "";
    return {
      settled: ENDED.includes(phase.toLowerCase()),
      phase,
      id,
      stages: (full.stages ?? []).map((s) => ({
        name: s.stageName || s.name || s.component || "a step",
        status: s.status ?? "",
        ...(s.errorMessage ? { said: s.errorMessage } : {}),
        ...(s.podName ? { pod: s.podName } : {}),
      })),
    };
  } catch (e) {
    return { settled: false, stages: [], unreachable: (e as Error).message };
  }
}

/**
 * Whether a failed step JUDGED the work, or could not run at all.
 *
 * The same rule the closing gate applies to its own checks, applied to
 * the world: a step that never reached a test or a compiler says nothing
 * about the work, and turning that into unkept promises sends people to
 * repair code nobody found fault with. An exit code cannot tell the two
 * apart — `main: Error (exit code 1)` is what a failing suite and an
 * unwritable cache both leave behind — so the step's own log is read.
 */
export function stepJudged(log: string): { judged: boolean; said: string } {
  const lines = log.split("\n").map((l) => l.trim()).filter(Boolean);
  // What a runner or a compiler says when it has actually judged.
  const judgment = lines.find((l) =>
    /^(FAIL|not ok\b|FAILED\b|E\s{2,}|AssertionError|\d+ (?:tests? )?failed|Tests:\s|--- FAIL)/.test(l) ||
      /\berror TS\d+:|\bSyntaxError\b|\bcompilation failed\b/i.test(l),
  );
  if (judgment) return { judged: true, said: judgment.slice(0, 200) };
  // What the machinery says when it never got that far.
  const machinery = lines
    .reverse()
    .find((l) =>
      /EACCES|EPERM|ENOSPC|ErrImagePull|ImagePullBackOff|permission denied|no space left|Killed|OOMKilled|context deadline|timed out|connection refused|could not resolve|unauthorized|forbidden|command not found|no such file/i.test(
        l,
      ),
    );
  return { judged: false, said: (machinery ?? lines[0] ?? "nothing in its log says what happened").slice(0, 200) };
}

/**
 * Run a component's own validation playbook and read the recap.
 *
 * The one downstream Tandem executes itself: `18_test.yaml` is the
 * component's definition of "deployed and working", it runs against the
 * live cluster from this pod via the repo's own wrapper, and its recap is
 * the verdict. Never a deploy, never a rollback — those are a person's
 * explicit ask.
 */
export async function runClusterValidation(a: {
  repoRoot: string;
  /** Repository-relative path to the 18_test playbook. */
  playbook: string;
  exec?: (cmd: string, args: string[], cwd: string) => Promise<{ code: number | null; out: string }>;
}): Promise<{ verdict: "green" | "red" | "unjudged"; detail: string }> {
  if (!/18_test[^/]*\.ya?ml$/.test(a.playbook))
    return { verdict: "unjudged", detail: `${a.playbook} is not a validation playbook — refusing to run it` };
  const run =
    a.exec ??
    ((cmd: string, args: string[], cwd: string) =>
      new Promise<{ code: number | null; out: string }>((resolve) =>
        execFile(cmd, args, { cwd, timeout: 600_000 }, (err, out, errOut) =>
          resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${out}${errOut}` }),
        ),
      ));
  const r = await run("./scripts/tk_ansible", [a.playbook], a.repoRoot);
  const recap = /failed=(\d+)/.exec(r.out);
  if (!recap)
    return {
      verdict: "unjudged",
      detail: `the playbook produced no recap — nothing here is a verdict about the component:\n${r.out.slice(-500)}`,
    };
  return recap[1] === "0" && r.code === 0
    ? { verdict: "green", detail: `validated on the live cluster: ${a.playbook}` }
    : { verdict: "red", detail: r.out.slice(-800) };
}

/**
 * What a pipeline reading means for a delivery's pending proofs.
 *
 * Test steps map to the staged criteria; the pipeline failing maps to all
 * of them. Unreachable maps to none — the machine's inability to look is
 * written on the proof, not into its verdict.
 */
export function stampPending(delivery: Delivery, reading: PipelineReading): Delivery {
  const proofs: Proof[] = delivery.proofs.map((p) => {
    if (p.verdict !== "pending" || !p.settledBy) return p;
    if (!reading.settled)
      return reading.unreachable ? { ...p, ref: `still pending — ${reading.unreachable}`.slice(0, 300) } : p;
    const tests = reading.stages.filter((s) => /^test-/.test(s.name));
    const failed = tests.filter((s) => s.status === "Failed" || s.status === "Error");
    if (reading.phase === "Succeeded")
      return { ...p, verdict: "green", ref: `settled by ${p.settledBy}: pipeline Succeeded`.slice(0, 300) };
    return {
      ...p,
      verdict: "red",
      ref:
        (failed.length
          ? `settled by ${p.settledBy}: ${failed.map((s) => s.name).join(", ")} failed`
          : `settled by ${p.settledBy}: pipeline ${reading.phase}`
        ).slice(0, 300),
    };
  });
  return { ...delivery, proofs };
}

/**
 * A person's attestation, for what only a person can settle — "installed
 * on a clean node" and its kin. Recorded onto the matching pending proof
 * in the person's own words; yes closes it green, no closes it red.
 */
export function attest(
  delivery: Delivery,
  criterionId: string,
  outcome: { held: boolean; note?: string; by: string; at: string },
): Delivery | { refused: string } {
  const target = delivery.proofs.find((p) => p.criterionId === criterionId && p.verdict === "pending");
  if (!target) return { refused: `no pending proof for criterion ${criterionId} on this delivery` };
  return {
    ...delivery,
    proofs: delivery.proofs.map((p) =>
      p === target
        ? {
            ...p,
            verdict: outcome.held ? "green" : "red",
            ref: `attested by ${outcome.by} at ${outcome.at}${outcome.note ? `: ${outcome.note}` : ""}`.slice(0, 300),
          }
        : p,
    ),
  };
}

/**
 * The watch an accept starts, for a gitops app.
 *
 * The merge's push fired the pipeline; this follows it until it settles
 * (bounded), stamping the delivery's pending proofs as answers arrive.
 * Every update goes through `update` so the space persists it and every
 * open surface sees it — the person watches promises close, not a spinner.
 */
export async function watchGitopsAfterAccept(a: {
  gitRoot: string;
  app: string;
  delivery: Delivery;
  acceptedAt: string;
  update: (d: Delivery, note: string) => void;
  log: (line: string) => void;
  /** Injectable for drives. */
  http?: Http;
  sleep?: (ms: number) => Promise<void>;
  remote?: string;
  token?: string;
  /** What to do once the deployed thing is actually serving, given its URL.
   *  The wait already exists here and nothing else knows when a deploy has
   *  landed; handing the moment over keeps that knowledge in one place and
   *  leaves this function ignorant of what happens next. */
  then?: (url: string) => Promise<void>;
}): Promise<void> {
  const stamping = a.delivery.proofs.some((p) => p.verdict === "pending" && p.settledBy);
  const remote =
    a.remote ??
    (await new Promise<string>((resolve) =>
      execFile("git", ["-C", a.gitRoot, "remote", "get-url", "origin"], (err, out) =>
        resolve(err ? "" : out.trim()),
      ),
    ));
  const controlUrl = controlUrlOf(remote);
  const token = a.token ?? apiToken();
  if (!controlUrl || !token) {
    a.log(
      `the pipeline cannot be watched (${!controlUrl ? "no platform remote" : "no api token at ~/.thinkube/api-token"}) — ` +
        `its promises stay pending, and that is a fact about this pod, not about the work`,
    );
    return;
  }
  const sleep = a.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms).unref()));
  const get = a.http ?? httpGet;
  let d = a.delivery;
  // ~10 minutes: the pipeline's own scale is about ninety seconds.
  for (let tick = 0; tick < 30; tick++) {
    const reading = await readPipeline({ controlUrl, app: a.app, since: a.acceptedAt, token, http: a.http });
    if (reading.settled) {
      if (stamping) d = stampPending(d, reading);
      // What the platform did with the merged work comes home, whichever
      // way it went. A delivery whose merged tree failed to build read
      // "accepted, every check green" for ever, and nobody was told.
      const held = (reading.phase ?? "").toLowerCase() === "succeeded";
      const broke = (reading.stages ?? []).filter((s) => /fail|error/i.test(s.status));
      // A failed step either JUDGED the work or could not run at all, and
      // its exit code cannot tell them apart. Its own log can.
      let judged = broke.length > 0;
      const words: string[] = [];
      for (const st of broke) {
        let said = st.said ?? "";
        if (st.pod && reading.id) {
          const answer: unknown = await get(
            `${controlUrl}/api/v1/cicd/pipelines/${reading.id}/logs/${st.pod}`,
            token,
          ).catch(() => "");
          const log =
            typeof answer === "string"
              ? answer
              : ((answer as { logs?: string; content?: string }).logs ??
                (answer as { content?: string }).content ??
                "");
          if (log) {
            const read = stepJudged(log);
            judged = read.judged;
            said = read.said;
          }
        }
        words.push(`${st.name}${said ? ` (${said})` : ""}`);
      }
      const outcome = held ? "held" : judged ? "broke" : "unjudged";
      d = {
        ...d,
        afterMerge: {
          at: new Date().toISOString(),
          outcome,
          said: "the platform's pipeline",
          ...(held
            ? {}
            : {
                detail: words.length
                  ? `${words.join(", ")} — ${words.length === 1 ? "this step" : "these steps"} ${judged ? "did not pass" : "could not run"}`
                  : `the pipeline ended ${reading.phase || "without succeeding"}`,
              }),
        },
      };
      a.update(
        d,
        held
          ? "the platform built and deployed the merged work" +
            (stamping ? " — the promises settled after the merge are answered" : "")
          : judged
            ? `the merged work did not build: ${d.afterMerge!.detail}`
            : `the platform could not judge the merged work: ${d.afterMerge!.detail} — nothing is known about the work from this`,
      );
      const url = deployedUrlOf(remote, a.app);
      if (held && a.then && url) await a.then(url);
      return;
    }
    await sleep(20_000);
  }
  a.log("the pipeline did not settle within the watch — what it did with the merged work is not known here yet; read it again later");
}

/**
 * The component's own validation, after its delivery is accepted.
 *
 * A playbook repository proves nothing in a worktree: what "deployed and
 * working" means is written in the component's own `18_test.yaml`, and it
 * runs against the live cluster. That is the one downstream Tandem can
 * execute itself — reading the recap as the verdict, never deploying,
 * never rolling back.
 *
 * Which component: the one whose directory the delivery's promises landed
 * in. A cut that touched no component has nothing to validate.
 */
export async function validateComponentsAfterAccept(a: {
  repoRoot: string;
  /** Repository-relative paths the delivered promises landed in. */
  landed: readonly string[];
  delivery: Delivery;
  update: (d: Delivery, note: string) => void;
  log: (line: string) => void;
  findPlaybook?: (repoRoot: string, dir: string) => string | undefined;
  run?: Parameters<typeof runClusterValidation>[0]["exec"];
}): Promise<void> {
  const pending = a.delivery.proofs.filter((p) => p.verdict === "pending" && p.settledBy);
  if (!pending.length) return;
  const find = a.findPlaybook ?? defaultFindPlaybook;
  const dirs = [...new Set(a.landed.map((f) => path.posix.dirname(f)))];
  const playbooks = [...new Set(dirs.map((d) => find(a.repoRoot, d)).filter((x): x is string => !!x))];
  if (!playbooks.length) {
    a.log(
      "no component validation playbook covers what this cut changed — its promises stay pending, " +
        "and that is a fact about this repository, not about the work",
    );
    return;
  }
  let d = a.delivery;
  for (const playbook of playbooks) {
    a.log(`validating on the live cluster: ${playbook}`);
    const r = await runClusterValidation({
      repoRoot: a.repoRoot,
      playbook,
      ...(a.run ? { exec: a.run } : {}),
    });
    d = {
      ...d,
      proofs: d.proofs.map((p) =>
        p.verdict === "pending" && p.settledBy
          ? r.verdict === "unjudged"
            ? { ...p, ref: `still pending — ${r.detail}`.slice(0, 300) }
            : { ...p, verdict: r.verdict, ref: r.detail.slice(0, 300) }
          : p,
      ),
    };
    a.update(d, `${playbook}: ${r.verdict}`);
  }
}

/** The `18_test` playbook that governs a directory, walking up to the
 *  component root — the convention this platform documents. */
function defaultFindPlaybook(repoRoot: string, dir: string): string | undefined {
  let here = dir;
  for (let up = 0; up < 4 && here && here !== "."; up++) {
    for (const name of ["18_test.yaml", "18_test.yml"]) {
      const rel = path.posix.join(here, name);
      if (fs.existsSync(path.join(repoRoot, rel))) return rel;
    }
    for (const n of fs.existsSync(path.join(repoRoot, here)) ? fs.readdirSync(path.join(repoRoot, here)) : [])
      if (/^18_test.*\.ya?ml$/.test(n)) return path.posix.join(here, n);
    here = path.posix.dirname(here);
  }
  return undefined;
}
