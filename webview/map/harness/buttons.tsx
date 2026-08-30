/**
 * Renders the surface for every phase and page without a host, and lists
 * every button with its enabled state — the button table, as the reader
 * would see it. Input: a JSON file of pushes by phase. Output: JSON.
 */
import * as fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { noteAllowed, refusalIfRefused, SpacePush, SURFACE_PAGES } from "../src/vscode";

// Layout effects do not run in a static render; the warning is noise here.
const warn = console.error;
console.error = (...a: unknown[]) => {
  if (typeof a[0] === "string" && a[0].includes("useLayoutEffect does nothing on the server")) return;
  warn(...a);
};

const pushes = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Record<string, SpacePush>;
const out: Record<string, Record<string, string[]>> = {};
for (const [phase, push] of Object.entries(pushes)) {
  // Every caller of the allowed-list recorder hands it the phase the same
  // push carried, or the sentence it renders is the bare fallback with no
  // control named in it.
  noteAllowed(push.allowed, push.phase);
  out[phase] = {};
  for (const tab of SURFACE_PAGES) {
    const html = renderToStaticMarkup(<App initial={{ push, tab }} />);
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
      // carries the sentence a person would read — not a blank column.
      const action = data.split(" ")[0]?.split("=")[0];
      const why = off && action ? refusalIfRefused(action) : undefined;
      buttons.push(
        (off ? "off " : "on  ") + (data || `"${text.slice(0, 30)}"`) + (why ? ` — ${why}` : ""),
      );
    }
    out[phase][tab] = buttons;
  }
}
process.stdout.write(JSON.stringify(out, null, 1));
