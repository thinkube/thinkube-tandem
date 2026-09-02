/**
 * One push per page, built from the recorded push, for checks that render
 * the surface. The page follows the state, so a check that wants a page
 * hands the surface the state that leads there.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { SpacePush } from "./surfaceContract";
import type { SurfacePage } from "./surfaceLayout";

const FIXTURE = path.resolve(__dirname, "..", "..", "src", "surfaces", "surfaceFits.push.json");
const BASE = JSON.parse(
  fs.readFileSync(fs.existsSync(FIXTURE) ? FIXTURE : path.join(__dirname, "surfaceFits.push.json"), "utf8"),
) as SpacePush;

/** The recorded push with nothing in flight: no run, no delivery, no reading pending. */
export function quietPush(over: Partial<SpacePush> = {}): SpacePush {
  return {
    ...BASE,
    phase: "understood",
    running: false,
    activity: undefined,
    grounding: [],
    pendingModel: undefined,
    deliveries: [],
    signedIdle: undefined,
    run: undefined,
    draft: "",
    cost: { subjects: 0, rounds: 0 },
    ready: { subjects: 0, promises: 0, asks: 0, thinking: false },
    specs: [],
    allowed: ["read-draft", "group-into-sets", "choose-set", "build", "reframe", "amend"],
    ...over,
  };
}

/** A thing carrying the sentences of the first subject that has promises. */
function firstThing(chosen: boolean): NonNullable<SpacePush["specs"]>[number] {
  const sub = BASE.subjects.find((s) => s.claims.some((c) => c.promises.length)) ?? BASE.subjects[0];
  const asks = [...new Set(sub.from.map((f) => f.n))];
  const promises = sub.claims.reduce((n, c) => n + c.promises.length, 0);
  return { id: "thing-1", name: "the first thing", subjects: 1, asks, promises, chosen, built: false, repos: ["r"] };
}

export function pushFor(page: SurfacePage): SpacePush {
  switch (page) {
    case "write":
      return quietPush({ sentences: [], subjects: [], draft: "one line\nanother" });
    case "intent":
      return quietPush({ specs: [firstThing(false)] });
    case "work": {
      const thing = firstThing(true);
      return quietPush({
        specs: [thing],
        ready: { subjects: 1, promises: thing.promises, asks: thing.asks?.length ?? 1, thinking: false },
        documentation: { state: "missing", landings: [] },
      });
    }
    case "flow":
      return { ...BASE, running: false, pendingModel: undefined, activity: undefined, grounding: [] };
  }
}
