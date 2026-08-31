/**
 * Looking at the deployed thing, and saying what is wrong with it.
 *
 * The step the loop was missing. A gate can only ask what a check can prove
 * before anything ships; this asks what a person would see afterwards, and
 * it asks the thing that was actually deployed rather than the tree it was
 * built from.
 *
 * It writes FINDINGS and never a verdict. Nothing here withholds anything,
 * fails anything, or counts against the work — that is what keeps it
 * blameless, and blamelessness is what keeps the information flowing. A
 * report that could cost a delivery is a report someone will argue with.
 *
 * Silence is the normal answer. A look that always produces something is
 * noise, and noise is another ledger nobody reads.
 */
import { canRender, openSurface } from "../gates/renderedSurface";

export interface Finding {
  /** What a person would notice, in their words. */
  said: string;
  /** Where it was seen, so it can be looked at again. */
  where: string;
}

/** Everything a page can tell you about itself without knowing what it is for. */
interface Seen {
  title: string;
  body: number;
  visible: number;
  text: number;
  regions: { what: string; height: number; top: number }[];
}

/**
 * The page's shape, named here rather than imported.
 *
 * This is host code and runs in node; the function below is shipped into a
 * browser and evaluated there. Giving this module the DOM to type six field
 * names would let every other line of host code reach for a document.
 */
type Box = { width: number; height: number; top: number };
type El = { getBoundingClientRect(): Box; attributes: ArrayLike<{ name: string }> };
type Doc = {
  title: string;
  body: { getBoundingClientRect(): Box; innerText?: string };
  querySelectorAll(sel: string): ArrayLike<El>;
};

const LOOK = (): Seen => {
  const d = (globalThis as unknown as { document: Doc }).document;
  const all = (sel: string): El[] => Array.from(d.querySelectorAll(sel));
  return {
    title: d.title,
    body: Math.round(d.body.getBoundingClientRect().height),
    visible: all("button,a,input,select,textarea").filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length,
    text: (d.body.innerText ?? "").trim().length,
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

/**
 * Open what was deployed and report what a person would notice.
 *
 * The questions are the ones that need no knowledge of what the thing is
 * for: is anything there, can anything be pressed, does a page have a size,
 * did the page itself throw. Those are exactly the failures that shipped
 * green — a window whose every page was laid out at zero height passed three
 * hundred and ninety-one checks, and one of these questions would have
 * caught it in a second.
 */
export async function theLook(a: {
  url: string;
  /** What this look is about, in the person's words — carried into what it
   *  says, so a finding names the ask it belongs to. */
  ask?: string;
  viewport?: { width: number; height: number };
}): Promise<{ findings: Finding[]; looked: boolean; why?: string }> {
  const why = await canRender();
  if (why) return { findings: [], looked: false, why };

  const at = a.ask ? `${a.url} · ${a.ask}` : a.url;
  let s;
  try {
    s = await openSurface({ url: a.url, viewport: a.viewport ?? { width: 1280, height: 900 } });
  } catch (err) {
    return {
      findings: [{ said: `it could not be opened at all: ${(err as Error).message.split("\n")[0]}`, where: at }],
      looked: true,
    };
  }
  try {
    const seen = { ...(await s.read(LOOK)), errors: [...s.threw()] };
    const findings: Finding[] = [];

    if (seen.text === 0 && seen.visible === 0)
      findings.push({ said: "the page is blank — no text and nothing that can be pressed", where: at });
    else if (seen.visible === 0)
      findings.push({ said: "there is text but nothing that can be pressed", where: at });

    for (const r of seen.regions) {
      if (r.height === 0)
        findings.push({ said: `${r.what} is drawn with no height — it is there and cannot be seen`, where: at });
      else if (r.top >= (a.viewport?.height ?? 900))
        findings.push({ said: `${r.what} starts below the bottom of the window`, where: at });
    }
    for (const e of [...new Set(seen.errors)].slice(0, 3))
      findings.push({ said: `the page threw: ${e}`, where: at });

    return { findings, looked: true };
  } finally {
    await s.close();
  }
}
