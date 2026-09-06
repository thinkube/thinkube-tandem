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
import { Cut, Space } from "../core/schema";
import { driveAll, ToDrive } from "./drive";
import { toDriveOf } from "./observations";
import { signInOnce } from "./theWayIn";
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
  // One directory per reviewer, named for it, beside the run's record.
  const looksIn = (id: string): string | undefined =>
    a.storeDir ? path.join(a.storeDir, "looks", a.runId ?? "run", id) : undefined;
  for (const id of ids) {
    const dir = looksIn(id);
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }
  // The way in, made once for all of them: signed in outside the model,
  // cut down to the product's own origin.
  const session = a.storeDir
    ? await signInOnce({ at: a.at, into: path.join(a.storeDir, "looks", a.runId ?? "run", "session.json") })
    : { why: "there is nowhere to keep a session" };
  if ("why" in session) a.log(`no signed-in session for the reviewers: ${session.why}`, "live");
  const proofs = await (a.drive ?? driveAll)(
    {
      at: a.at,
      model: a.deps.model,
      log: (l) => a.log(l, "live"),
      looksIn: (id: string) => looksIn(id),
      ...("path" in session ? { sessionFile: session.path } : {}),
    },
    list,
    ids,
  );
  // What each reviewer looked at, on its own card.
  for (const id of ids) {
    const dir = looksIn(id);
    if (!dir) continue;
    const shots = (() => {
      try {
        return fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(dir, f));
      } catch {
        return [];
      }
    })();
    a.st.looked(id, shots);
  }
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
  // A judged criterion is no longer the person's to certify.
  const settled = list.flatMap((c, i) =>
    c.criteria.filter((_, j) => proofs[i]?.[j]?.verdict !== "unjudged").map((x) => x.text),
  );
  return {
    ...a.outcome,
    delivery: {
      ...d,
      proofs: [...d.proofs.filter((p) => !p.criterionId || !judgedAgain.has(p.criterionId)), ...proofs.flat()],
      ...(d.observations
        ? { observations: d.observations.filter((o) => !settled.some((c) => o.startsWith(c))) }
        : {}),
    },
  };
}
