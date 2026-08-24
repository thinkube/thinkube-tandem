/**
 * The whole journey without a window: asks in, delivery out.
 *
 * `headless.ts` runs a cut that is already signed, which covers the
 * expensive half and none of the half where the plan is made. So the
 * derivation could only ever be exercised by a person clicking through
 * four screens, and every question about it — does it slice this the same
 * way twice, does the door refuse what it should — cost a person an
 * evening and could not be asked twice under the same conditions.
 *
 * This runs the same session the editor drives, in the same order a person
 * drives it: write the asks, read them, keep the reading, work out what to
 * build, sign, run. Nothing here is a second implementation; every step is
 * the method the panel calls.
 *
 *   node out/cli/journey.js --asks <file> --repo <repo> --space <dir>
 *                           [--suite "npm test"] [--prepare "npx tsc -p ."]
 *                           [--model opus] [--worker sonnet] [--stop-after sign]
 *
 * Exit code 0 for a delivery, 1 for anything else — so a loop can read it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { TandemSession } from "../surfaces/session";
import { knowledgeOf } from "../derive/knowledge";
import { factsOf } from "../run/facts";
import { Forge, forgeFor } from "../dispatch/forge";
import { execFile } from "node:child_process";
import type { Delivery } from "../core/schema";

interface Args {
  asks: string;
  repo: string;
  space: string;
  suite: string[];
  prepare?: string;
  model: string;
  worker: string;
  /** Stop before the expensive part, to exercise only the thinking. */
  stopAfter?: "read" | "keep" | "think" | "sign";
}

export function parseArgs(argv: readonly string[]): Args | string {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const asks = get("asks");
  const repo = get("repo");
  const space = get("space");
  if (!asks || !repo || !space)
    return "usage: --asks <file of one ask per line> --repo <repo dir> --space <new or existing space dir> [--suite <cmd>] [--prepare <cmd>] [--model <m>] [--worker <m>] [--stop-after read|keep|think|sign]";
  const stop = get("stop-after");
  if (stop && !["read", "keep", "think", "sign"].includes(stop))
    return `--stop-after must be one of read, keep, think, sign (got ${stop})`;
  return {
    asks: path.resolve(asks),
    repo: path.resolve(repo),
    space: path.resolve(space),
    suite: (get("suite") ?? "npm test").split(" ").filter(Boolean),
    ...(get("prepare") ? { prepare: get("prepare")! } : {}),
    model: get("model") ?? "opus",
    worker: get("worker") ?? "sonnet",
    ...(stop ? { stopAfter: stop as Args["stopAfter"] } : {}),
  };
}

/** One line of progress, stamped, so a long run can be read as it happens. */
function say(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

/** A file-backed store for the repository reading, keyed by the tree's stamp. */
function digestStore(dir: string): { load: (k: string) => string | undefined; save: (k: string, t: string) => void } {
  const file = path.join(dir, "knowledge.json");
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  return {
    load: (k) => read()[k],
    save: (k, t) => {
      const all = read();
      all[k] = t;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all, null, 2));
    },
  };
}


/**
 * The repository's forge, from its own remote — the same resolution the
 * editor does, including a credentialed https remote whose token doubles
 * as the forge token.
 */
async function forgeOf(repoRoot: string): Promise<Forge | undefined> {
  const remoteRaw = await new Promise<string>((resolve) =>
    execFile("git", ["-C", repoRoot, "remote", "get-url", "origin"], (err, out) =>
      resolve(err ? "" : out.trim()),
    ),
  );
  if (!remoteRaw) return undefined;
  const creds = /^https?:\/\/([^/@:]+):([^/@]+)@/.exec(remoteRaw);
  const remote = creds ? remoteRaw.replace(`${creds[1]}:${creds[2]}@`, "") : remoteRaw;
  return forgeFor(remote, {
    ...(process.env.TANDEM_GITEA_TOKEN || creds?.[2]
      ? { giteaToken: process.env.TANDEM_GITEA_TOKEN || creds![2] }
      : {}),
    http: async (method, url, token, payload) => {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
      return (await res.json()) as unknown;
    },
  });
}

/**
 * The closing report's own decision, pure: which delivery is being
 * reported, and whether it is the outcome of the run that just finished.
 *
 * A space can hold a delivery an EARLIER run left behind — the run just
 * watched may have refused before dispatch, or delivered nothing at all.
 * Printing the newest delivery's proofs as "this run's outcome" without
 * checking whose run produced it reports a stranger's work as this run's.
 * So the report always names the run that produced what it is showing,
 * and says so plainly when that differs from the run just watched.
 */
export function closingReportOf(deliveries: readonly Delivery[], justFinishedRunId: string): string {
  const delivered = deliveries[deliveries.length - 1];
  if (!delivered) return "no delivery was produced\n";
  const produced =
    delivered.runId && delivered.producedAt
      ? `run ${delivered.runId} — produced ${delivered.producedAt}`
      : "produced by a run this space did not record";
  const stale = delivered.runId !== undefined && delivered.runId !== justFinishedRunId;
  const heading = stale
    ? `this delivery is from an earlier run, not the one just finished — ${produced}\n`
    : `${produced}\n`;
  return (
    heading +
    (delivered.withheld
      ? `withheld: ${delivered.withheld}\n`
      : `delivered — ${delivered.proofs.length} proof(s)${delivered.undelivered?.length ? `, ${delivered.undelivered.length} promise(s) undelivered` : ""}\n`)
  );
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    process.stdout.write(`${args}\n`);
    return 2;
  }
  const asks = fs.readFileSync(args.asks, "utf8").trim();
  if (!asks) {
    say(`${args.asks} is empty — there is nothing to ask for`);
    return 2;
  }
  fs.mkdirSync(args.space, { recursive: true });

  // The repository's own forge, resolved exactly as the editor resolves
  // it. The run refuses to start without one, so a journey that did not
  // look for it stopped at the last step with a note about a setting —
  // having already paid for the whole derivation.
  const forge = await forgeOf(args.repo).catch((e: unknown) => {
    say(`no forge could be resolved: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  });
  if (forge) say(`the delivery would open on ${args.repo}'s own forge`);
  // The run refuses to start without a forge, and derivation is the
  // expensive half. Refusing here costs nothing; refusing after it has
  // been paid for is the whole cost of the journey for a note about a
  // setting — which is exactly what the first headless journey did.
  if (!forge && !args.stopAfter) {
    say("⛔ no forge is reachable for this repository, so a run could not start — nothing was derived");
    return 2;
  }

  const told = factsOf(args.repo);
  const known = await knowledgeOf({
    deps: { model: args.model, repoRoot: args.repo, log: (l) => say(`  ${l}`) },
    cacheRoot: path.join(args.space, "graphs"),
    decisions: [],
    store: digestStore(args.space),
  }).catch((e: unknown) => {
    say(`the repository reading was unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  });

  /** The stage each subject was last reported on, so a repeat is silent. */
  const stageSaid = new Map<string, string>();
  const session = new TandemSession({
    round: { model: args.model, volumeModel: args.worker, repoRoot: args.repo },
    storeDir: args.space,
    storageDir: path.join(args.space, ".local"),
    now: () => new Date().toISOString(),
    // The TEP number is counted per author, and the run's branch is named
    // for the TEP. Two spaces under one author therefore both mint number
    // one and land on the SAME branch: the second run resumed the first's
    // work, took its slices as standing, and inherited a plan it did not
    // satisfy. The space names itself.
    author: process.env.TANDEM_AUTHOR ?? path.basename(args.space),
    suiteCommand: args.suite,
    ...(args.prepare ?? told?.prepare ?? known?.prepare
      ? { prepareCommand: args.prepare ?? told?.prepare ?? known!.prepare }
      : {}),
    workerModel: { workerModel: args.worker },
    ...(forge ? { forge } : {}),
    ...(known ? { knowledge: async () => known } : {}),
    // Working out what to build is the longest step and the quietest: its
    // progress arrives as a change with no message, so a plain listener
    // prints nothing for minutes and the run looks hung. The stage each
    // subject is on is said whenever it moves.
    onChanged: (message) => {
      if (message) say(message);
      for (const g of session.groundingView()) {
        const at = `${g.label} ${g.current}/${g.total}`;
        if (stageSaid.get(g.askId) === at) continue;
        stageSaid.set(g.askId, at);
        say(`  · ${g.askId}: ${at}`);
      }
      // The whole-cut passes — looking for what is still missing, shaping
      // the seams — report here and nowhere else. Without this the last
      // several minutes of thinking are a blank screen.
      const a = session.activity;
      const now = a ? `${a.label} ${a.current}/${a.total}` : "";
      if (now && stageSaid.get("*activity*") !== now) {
        stageSaid.set("*activity*", now);
        say(`  · ${now}`);
      }
    },
  });

  // Each step is the one the panel calls, in the order a person presses
  // them. A step that refuses stops the journey and says why — the same
  // sentence a person would have read on the screen.
  const step = async (
    name: string,
    run: () => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string },
  ): Promise<boolean> => {
    say(`▸ ${name}`);
    const r = await run();
    if (!r.ok) say(`⛔ ${name}: ${r.reason ?? "refused, with no reason given"}`);
    return r.ok;
  };

  session.saveDraft(asks);
  say(`${asks.split("\n").filter((l) => l.trim()).length} ask(s) written into ${args.space}`);

  if (!(await step("reading what was written", () => session.readDraft()))) return 1;
  if (args.stopAfter === "read") return 0;

  if (!(await step("keeping the reading", () => session.keepDraft()))) return 1;
  say(`${session.space.asks.length} ask(s) recorded, ${(session.space.subjects ?? []).length} subject(s) read`);
  if (args.stopAfter === "keep") return 0;

  if (!(await step("working out what to build", () => session.think()))) return 1;
  say(`${session.space.nodes.length} promise(s) derived`);
  if (args.stopAfter === "think") return 0;

  // Build signs the cut and starts the workers — the one press that spends.
  if (args.stopAfter === "sign") {
    say("stopping before the build, as asked — the promises are derived and unsigned");
    return 0;
  }
  if (!(await step("signing and building", () => session.build()))) return 1;

  // Signing starts the run and does not wait for it: the gesture exists to
  // make a panel responsive, so `build()` returns the moment the workers
  // are dispatched. A journey that returned there reported "no delivery"
  // while the run it had just started was still on its first worker.
  if (session.running) {
    say("the workers are running — waiting for the delivery");
    while (session.running) await new Promise((r) => setTimeout(r, 5000));
  }

  const delivered = session.space.deliveries[session.space.deliveries.length - 1];
  const justFinishedRunId = session.runState?.view()?.runId ?? "";
  process.stdout.write(`\n── ${args.space} ──\n` + closingReportOf(session.space.deliveries, justFinishedRunId));
  return delivered && !delivered.withheld ? 0 : 1;
}

if (require.main === module)
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
