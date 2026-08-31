/**
 * Renders the surface for every phase and page without a host, and lists
 * every button with its enabled state — the button table, as the reader
 * would see it. Input: a JSON file of pushes by phase. Output: JSON.
 */
import * as fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { noteAllowed, refusalIfRefused, SHAPING, SpacePush, SURFACE_PAGES } from "../src/vscode";

// Layout effects do not run in a static render; the warning is noise here.
const warn = console.error;
console.error = (...a: unknown[]) => {
  if (typeof a[0] === "string" && a[0].includes("useLayoutEffect does nothing on the server")) return;
  warn(...a);
};

/**
 * One row per button in a rendered page: whether it is on or off, the
 * handles it carries, and — when it is off and the phase governs it — the
 * sentence a person would read instead of a blank column.
 *
 * Separated from the command below so the row building is a function that
 * can be called with a push, rather than work that only happens as a side
 * effect of running the file with an argv.
 */
export function buttonRows(html: string): string[] {
  const buttons: string[] = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = m[1];
    if (/data-tab=/.test(attrs)) continue;
    const data = [...attrs.matchAll(/data-([a-z-]+)(?:="([^"]*)")?/g)]
      .map((d) => d[1] + (d[2] && d[2] !== "true" ? "=" + d[2] : ""))
      .join(" ");
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (!data && /^[+−]$|^Fit$/.test(text)) continue;
    const off = /\bdisabled(=""|\b)/.test(attrs);
    // The action a control's data-handle names, so an off control's row
    // carries the sentence a person would read — not a blank column. A
    // button can carry several handles (data-reframe beside data-amend),
    // and only the governed one has a refusal to give, so the governed
    // handle is the one read rather than whichever came first.
    const handles = data.split(" ").map((d) => d.split("=")[0]);
    const action = handles.find((h) => SHAPING.has(h));
    const why = off && action ? refusalIfRefused(action) : undefined;
    buttons.push(
      (off ? "off " : "on  ") + (data || `"${text.slice(0, 30)}"`) + (why ? ` — ${why}` : ""),
    );
  }
  return buttons;
}

/**
 * The markup the surface really renders for one push, page by page.
 *
 * A handle proof that reads the source files only ever proves that somebody
 * wrote the characters down: a handle sitting in a branch no page takes, or
 * on a component nothing mounts, satisfies a text search while the person
 * looking for that control finds nothing. Rendering answers the stronger
 * question — the handle is in the markup a reader would receive — and it
 * reaches the page components themselves rather than stopping at the
 * registry that describes them.
 */
export function markupFor(push: SpacePush): Record<string, string> {
  noteAllowed(push.allowed, push.phase);
  const pages: Record<string, string> = {};
  for (const tab of SURFACE_PAGES) {
    pages[tab] = renderToStaticMarkup(<App initial={{ push, tab }} />);
  }
  // The orchestration page shows the workers or the delivery report, and a
  // reader chooses between them. Rendering only the default would leave the
  // report's own page unreached, so it is rendered under its own key the way
  // a reader who opened the report would see it.
  pages["flow:report"] = renderToStaticMarkup(
    <App initial={{ push, tab: "flow", flowView: "report" }} />,
  );
  return pages;
}

/** The button table for one push, page by page. */
export function tableFor(push: SpacePush): Record<string, string[]> {
  // Every caller of the allowed-list recorder hands it the phase the same
  // push carried, or the sentence it renders is the bare fallback with no
  // control named in it.
  noteAllowed(push.allowed, push.phase);
  const pages: Record<string, string[]> = {};
  for (const tab of SURFACE_PAGES) {
    pages[tab] = buttonRows(renderToStaticMarkup(<App initial={{ push, tab }} />));
  }
  return pages;
}

/** The button table for every phase in the given file of pushes. */
export function tableOf(pushes: Record<string, SpacePush>): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [phase, push] of Object.entries(pushes)) out[phase] = tableFor(push);
  return out;
}

// Run as a command: read the pushes named on the command line and print the
// table. Guarded so importing this module builds nothing and prints nothing.
if (process.argv[2]) {
  const pushes = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Record<string, SpacePush>;
  process.stdout.write(JSON.stringify(tableOf(pushes), null, 1));
}
