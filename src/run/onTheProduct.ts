/**
 * The run's last piece of work: judging, on the running product, what only
 * the running product can show.
 *
 * It happens after the deployment because it depends on the deployment.
 * Each criterion gets its own reviewer, they run beside each other, and
 * each is a node in the run's graph that waits on the live one — so from
 * the last check to the first look the person is never watching a still
 * picture.
 *
 * A reviewer's verdict rides the delivery as evidence like any other. What
 * no reviewer could settle stays an observation for the person, which is
 * what it was before anything could be driven.
 */
import { Cut, Proof, Space } from "../core/schema";
import { driveAll, originOf, ToDrive } from "./drive";
import { Finding } from "./findings";
import { toDriveOf } from "./observations";
import { signInOnce, theWayInWorks } from "./theWayIn";
import { openTheBrowser } from "./theBrowser";
import * as fs from "node:fs";
import * as path from "node:path";
import { DispatchOutcome, RunState } from "./state";

/** The id a criterion's reviewer is drawn under, from the first frame of
 *  the run to its verdict. */
function driverId(n: number): string {
  return `on-the-product-${n}`;
}

/**
 * The reviewers this cut will need, seeded before anything runs.
 *
 * They sit in the graph from the first frame, waiting on the deployment,
 * so the shape of the whole run — including what will be judged on the
 * product — is visible while the work is still being built.
 */
export function seedDrivers(st: RunState, space: Space, cut: Cut, pageRoots: readonly string[]): string[] {
  const list = toDriveOf(space, cut, pageRoots);
  list.forEach((c, i) =>
    st.seed(
      driverId(i + 1),
      "live",
      "drive",
      ["live"],
      `${c.promise}\n${c.criteria.map((x) => `- ${x.text}`).join("\n")}`,
      [{ on: "live", kind: "needs", what: "it can only be judged once the product is answering" }],
    ),
  );
  return list.map((_, i) => driverId(i + 1));
}

export async function judgeOnTheProduct(a: {
  at: string;
  st: RunState;
  log: (line: string, step: string) => void;
  deps: { model: string };
  space: Space;
  cut: Cut;
  outcome: DispatchOutcome;
  /** Where the page is built, as the repository declares it. */
  pageRoots: readonly string[];
  /** Where this run keeps its record — the reviewers' pictures go beside
   *  it, one directory each. */
  storeDir?: string;
  runId?: string;
  /** Injectable for tests: what actually opens the browser. */
  drive?: typeof driveAll;
  /** Judge only these promises, by sentence — a repair re-drives what was
   *  red, never the whole page again. */
  only?: (promise: string) => boolean;
}): Promise<DispatchOutcome> {
  const all: ToDrive[] = toDriveOf(a.space, a.cut, a.pageRoots);
  const list = a.only ? all.filter((c) => a.only!(c.promise)) : all;
  if (!list.length) return a.outcome;
  const ids = list.map((c) => driverId(all.findIndex((x) => x.promise === c.promise) + 1));
  for (const id of ids) if (!a.st.units.has(id)) seedDrivers(a.st, a.space, a.cut, a.pageRoots);
  // A promise judged again replaces its earlier verdicts: one answer per
  // criterion, the newest.
  const judgedAgain = new Set(list.flatMap((c) => c.criteria.map((x) => x.id).filter(Boolean) as string[]));
  for (const id of ids) a.st.set(id, "running");
  // Where the reviewers' pictures and their way in are kept, beside the
  // run's own record.
  const here = a.storeDir ? path.join(a.storeDir, "looks", a.runId ?? "run") : undefined;
  if (here) fs.mkdirSync(here, { recursive: true });
  const session = here
    ? await signInOnce({ at: a.at, into: path.join(here, "session.json") })
    : { why: "there is nowhere to keep a session" };
  // Asked once, here: a session that does not open the product sends every
  // reviewer to the sign-on host, which their own origin limit refuses.
  // Knowing that, no reviewer is started: driving them anyway spends
  // minutes to write the same lockout on every criterion, and a criterion
  // nobody could reach is unjudged, never a verdict on the work.
  const noWayIn =
    "why" in session
      ? session.why
      : await (async () => {
          const works = await theWayInWorks({ at: a.at, sessionFile: session.path });
          if ("why" in works) return works.why;
          a.log(`the session opens ${a.at}`, "live");
          return undefined;
        })();
  if (noWayIn) {
    a.log(`the reviewers are locked out, so none was started — ${noWayIn}`, "live");
    for (const id of ids) a.st.fail(id, `no way in to the running product — ${noWayIn}`);
    const held = a.outcome.delivery;
    if (!held) return a.outcome;
    return {
      ...a.outcome,
      delivery: {
        ...held,
        proofs: [
          ...held.proofs.filter((p) => !p.criterionId || !judgedAgain.has(p.criterionId)),
          ...list.flatMap((c) =>
            c.criteria.map((x) => ({
              kind: "assessment" as const,
              label: x.text,
              verdict: "unjudged" as const,
              ref: `no reviewer could sign in, so nothing was judged: ${noWayIn}`,
              ...(x.id ? { criterionId: x.id } : {}),
            })),
          ),
        ],
      },
    };
  }

  // One browser each, opened when the reviewer starts and closed when it
  // is done — and one opened here first, so a machine that cannot start a
  // browser at all is said once rather than three times.
  const openOne = (who: string) =>
    openTheBrowser({
      origin: originOf(a.at),
      ...(here ? { outputDir: path.join(here, who) } : {}),
      ...("path" in session ? { sessionFile: session.path } : {}),
      log: (l) => a.log(l, who),
    });
  const browser = await openOne(ids[0] ?? "on-the-product-1");
  if ("why" in browser) {
    a.log(`no browser for the reviewers: ${browser.why}`, "live");
    for (const id of ids) a.st.fail(id, `no browser on this machine — ${browser.why}`);
    const held = a.outcome.delivery;
    if (!held) return a.outcome;
    return {
      ...a.outcome,
      delivery: {
        ...held,
        proofs: [
          ...held.proofs,
          ...list.flatMap((c) =>
            c.criteria.map((x) => ({
              kind: "assessment" as const,
              label: x.text,
              verdict: "unjudged" as const,
              ref: `no browser on this machine, so nothing was judged: ${browser.why}`,
              ...(x.id ? { criterionId: x.id } : {}),
            })),
          ),
        ],
      },
    };
  }
  browser.close();
  const proofs = await (a.drive ?? driveAll)(
    {
      at: a.at,
      model: a.deps.model,
      ...(here ? { looksIn: here } : {}),
      log: (l) => a.log(l, "live"),
      // A reviewer's own account belongs on its own card, the way a
      // worker's does — three of them in one stream reads as nobody's.
      logFor: (who, l) => a.log(l, who),
      stop: a.st.stop.signal,
    },
    list,
    ids,
    openOne,
  );
  // Each reviewer's card carries the pictures its own verdicts carry.
  proofs.forEach((forOne, i) => {
    const shots = forOne.flatMap((p) => (p.looks ?? []).map((l) => l.path));
    if (shots.length) a.st.looked(ids[i], shots);
  });
  // The card says what the reviewer found: failed when a criterion did
  // not hold, and failed with its own reason when nothing came back.
  proofs.forEach((forOne, i) => {
    const red = forOne.find((p) => p.verdict === "red");
    if (forOne.every((p) => p.verdict === "unjudged"))
      a.st.fail(ids[i], "no verdict came back — the promise stays for you to certify");
    else if (red) a.st.fail(ids[i], red.label);
    else a.st.set(ids[i], "done");
  });
  const d = a.outcome.delivery;
  if (!d) return a.outcome;
  // What the reviewers saw that nobody asked about, carried to the person
  // with the run's other findings.
  const noticed = proofs.flatMap((forOne) => (forOne as Proof[] & { noticed?: Finding[] }).noticed ?? []);
  // A judged criterion is no longer the person's to certify.
  const settled = list.flatMap((c, i) =>
    c.criteria.filter((_, j) => proofs[i]?.[j]?.verdict !== "unjudged").map((x) => x.text),
  );
  return {
    ...a.outcome,
    delivery: {
      ...d,
      proofs: [...d.proofs.filter((p) => !p.criterionId || !judgedAgain.has(p.criterionId)), ...proofs.flat()],
      ...(noticed.length ? { findings: [...(d.findings ?? []), ...noticed] } : {}),
      ...(d.observations
        ? { observations: d.observations.filter((o) => !settled.some((c) => o.startsWith(c))) }
        : {}),
    },
  };
}
