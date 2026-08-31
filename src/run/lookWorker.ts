/**
 * A worker that drives the deployed thing for one ask, and says what it found.
 *
 * The generic look beside this one asks questions that need no knowledge of
 * what a page is for: is anything there, can anything be pressed, does a
 * region have a size. Those catch a broken page. They cannot catch a page
 * that works and does not do what was asked, because only the ask says what
 * that is.
 *
 * So this one carries the person's own sentence to the deployed page and
 * gets there by pressing things. "Open the intent tab and tell me whether
 * the asks section is usable" has an answer; "check the surface" does not,
 * which is why a worker is scoped to one ask and never to a product.
 *
 * It writes FINDINGS and never a verdict. Nothing here withholds anything or
 * counts against the work — that is what keeps it blameless, and
 * blamelessness is what keeps the information flowing. Silence is the normal
 * answer, and a worker that always finds something is noise.
 */
import type { RoundDeps } from "../derive/round";
import { runReadRound } from "../derive/round";
import { volumeDeps } from "../derive/round";
import { canRender, openSurface } from "../gates/renderedSurface";
import type { Finding } from "./theLook";

/** How many presses one worker may spend before it must answer. A page
 *  reached in six gestures and not answered is a page the ask does not
 *  describe; spending more turns buys a longer silence, not a better one. */
const GESTURES = 6;

/** What the page tells a reader about itself, in the words a person would
 *  use. Handles are the attribute names a press can name, so what the worker
 *  may do next is read off the page rather than guessed. */
interface Page {
  title: string;
  text: string;
  handles: string[];
  regions: { what: string; height: number; top: number }[];
  threw: string[];
}

type El = {
  getBoundingClientRect(): { width: number; height: number; top: number };
  attributes: ArrayLike<{ name: string }>;
  innerText?: string;
};
type Doc = {
  title: string;
  body: { innerText?: string };
  querySelectorAll(sel: string): ArrayLike<El>;
};

const DESCRIBE = (): Omit<Page, "threw"> => {
  const d = (globalThis as unknown as { document: Doc }).document;
  const all = (sel: string): El[] => Array.from(d.querySelectorAll(sel));
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const el of all("[data-],button,a,[role=button],[data-choose-set],[data-tab]")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    for (const at of Array.from(el.attributes))
      if (at.name.startsWith("data-") && !seen.has(at.name)) {
        seen.add(at.name);
        handles.push(at.name);
      }
  }
  return {
    title: d.title,
    text: (d.body.innerText ?? "").trim().slice(0, 4000),
    handles: handles.slice(0, 60),
    regions: all("[data-write-page],[data-intent-page],[data-work-page],[data-flow-page]").map((el) => {
      const r = el.getBoundingClientRect();
      return {
        what: Array.from(el.attributes).map((x) => x.name).find((n) => n.endsWith("-page")) ?? "a page",
        height: Math.round(r.height),
        top: Math.round(r.top),
      };
    }),
  };
};

function brief(ask: string, page: Page, pressed: string[]): string {
  return [
    "You are looking at a page that has just been deployed, on behalf of the",
    "person who asked for this:",
    "",
    `    ${ask}`,
    "",
    "Answer only about that ask. You are not reviewing the product.",
    "",
    `THE PAGE IS TITLED: ${page.title || "(no title)"}`,
    "",
    "WHAT IT SAYS:",
    page.text || "(nothing — the page has no text)",
    "",
    `WHAT CAN BE PRESSED: ${page.handles.join(", ") || "(nothing)"}`,
    ...(page.regions.length
      ? ["", "REGIONS: " + page.regions.map((r) => `${r.what} ${r.height}px high, top ${r.top}px`).join("; ")]
      : []),
    ...(page.threw.length ? ["", "THE PAGE THREW: " + page.threw.slice(0, 3).join(" · ")] : []),
    ...(pressed.length ? ["", `YOU HAVE ALREADY PRESSED: ${pressed.join(", ")}`] : []),
    "",
    "If you must go somewhere else to judge the ask, answer with one line:",
    "",
    "    PRESS <handle>",
    "",
    "naming one handle from the list above. Otherwise answer with:",
    "",
    "    NOTHING",
    "",
    "when the ask holds — which is the normal answer and needs no explanation —",
    "or one line per problem, in the person's own register, saying what they",
    "would notice:",
    "",
    "    FOUND <what a person would see>",
    "",
    "Never report that something could not be checked, and never describe the",
    "page back. Only what is wrong, only about this ask.",
  ].join("\n");
}

function readReply(reply: string, where: string): { press?: string; findings: Finding[] } {
  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  const press = lines.find((l) => /^PRESS\s+/i.test(l));
  if (press) return { press: press.replace(/^PRESS\s+/i, "").trim(), findings: [] };
  return {
    findings: lines
      .filter((l) => /^FOUND\s+/i.test(l))
      .map((l) => ({ said: l.replace(/^FOUND\s+/i, "").trim(), where }))
      .filter((f) => f.said.length > 0),
  };
}

/**
 * Drive the deployed page for one ask.
 *
 * Fail-soft everywhere: a page that will not open, a round that answers
 * nothing, a handle that is not there — none of them is reported as a
 * problem with the work, because none of them is evidence about the ask. A
 * look that cannot look says so to the log and returns nothing.
 */
export async function lookAtAsk(a: {
  url: string;
  /** The person's own sentence. */
  ask: string;
  deps: RoundDeps;
  viewport?: { width: number; height: number };
  round?: typeof runReadRound;
  log?: (line: string) => void;
  /** Injectable for drives, as the rest of the after-merge machinery is. */
  open?: typeof openSurface;
  can?: typeof canRender;
}): Promise<{ findings: Finding[]; looked: boolean; why?: string }> {
  const why = await (a.can ?? canRender)();
  if (why) return { findings: [], looked: false, why };

  const at = `${a.url} · ${a.ask}`;
  let s;
  try {
    s = await (a.open ?? openSurface)({ url: a.url, viewport: a.viewport ?? { width: 1280, height: 900 } });
  } catch (err) {
    return {
      findings: [{ said: `it could not be opened at all: ${(err as Error).message.split("\n")[0]}`, where: at }],
      looked: true,
    };
  }

  const round = a.round ?? runReadRound;
  const pressed: string[] = [];
  try {
    for (let turn = 0; turn <= GESTURES; turn++) {
      const page: Page = { ...(await s.read(DESCRIBE)), threw: [...s.threw()] };
      const reply = await round(volumeDeps(a.deps), brief(a.ask, page, pressed));
      if (!reply) return { findings: [], looked: true, why: "the round answered nothing" };

      const { press, findings } = readReply(reply, at);
      if (!press) return { findings, looked: true };
      if (turn === GESTURES || pressed.includes(press) || !page.handles.includes(press))
        return { findings: [], looked: true };
      pressed.push(press);
      a.log?.(`the look presses ${press}`);
      try {
        await s.press(press);
      } catch {
        return { findings: [], looked: true };
      }
    }
    return { findings: [], looked: true };
  } finally {
    await s.close();
  }
}
