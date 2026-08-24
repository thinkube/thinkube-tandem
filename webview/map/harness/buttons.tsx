/**
 * Renders the surface for every phase and page without a host, and lists
 * every control with its enabled state — the control table, as the reader
 * would see it. Buttons first, then the boxes a person types into that
 * carry a data- name: a gesture whose control is a button plus a box is
 * only half visible in a table of buttons. Output: JSON.
 *
 * Input: a JSON file of pushes by phase, or — with no argument — one push
 * per phase built HERE from the host's own table. The built pushes carry
 * `allowedNow(phase)` rather than a hand-written list, so the state of
 * every control in the table is decided by the same rule the host decides
 * it by. A fixture that spelled its own `allowed` list could say a control
 * is on in a phase where the host refuses it, and the render would agree
 * with the fixture instead of with the product.
 */
import * as fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { noteAllowed, SHAPING_ACTIONS, SpacePush } from "../src/vscode";
import { submitDocsWaiver } from "../src/Rail";
import { allowedNow, Phase } from "../../../src/surfaces/phase";

// Layout effects do not run in a static render; the warning is noise here.
const warn = console.error;
console.error = (...a: unknown[]) => {
  if (typeof a[0] === "string" && a[0].includes("useLayoutEffect does nothing on the server")) return;
  warn(...a);
};

const PHASES: readonly Phase[] = [
  "drafting",
  "read",
  "understood",
  "signed",
  "running",
  "delivered",
];

/**
 * A space with work ready to commit, in one phase. `ready.subjects` is what
 * makes the rail draw the commit section — the cut review, the not-needed
 * reason and its control all live there — so a table built from these
 * pushes covers the controls that only appear when there is something to
 * sign.
 */
function pushFor(phase: Phase): SpacePush {
  return {
    kind: "space",
    running: phase === "running",
    phase,
    allowed: allowedNow(phase),
    signedTeps: 0,
    questions: [],
    decisions: [],
    orphans: [],
    sentences: [],
    cost: { subjects: 0, rounds: 0 },
    outOfDate: { promises: 0, subjects: 0, rounds: 0 },
    ready: { subjects: 1, promises: 1, asks: 1, thinking: false },
    draft: "",
    impacts: [],
    subjects: [],
    cutCount: 1,
    deliveries: [],
  };
}

const fixture = process.argv[2];
const pushes: Record<string, SpacePush> = fixture
  ? (JSON.parse(fs.readFileSync(fixture, "utf8")) as Record<string, SpacePush>)
  : Object.fromEntries(PHASES.map((p) => [p, pushFor(p)]));
const TABS = ["write", "intent", "work", "flow"] as const;
// Per phase: the controls on each tab. Plus one "gestures:" row that
// records what a control actually sends, which no render can show.
const out: Record<string, Record<string, string[]> | Record<string, unknown>> = {};
for (const [phase, push] of Object.entries(pushes)) {
  noteAllowed(push.allowed);
  const tabs: Record<string, string[]> = {};
  out[phase] = tabs;
  for (const tab of TABS) {
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
      buttons.push((/\bdisabled(=""|\b)/.test(attrs) ? "off " : "on  ") + (data || `"${text.slice(0, 30)}"`));
    }
    // A button is not the only control a person acts through. Where a
    // gesture needs something typed before it can be pressed — the
    // not-needed reason beside "Documentation not needed" — the box IS
    // half the control, and a table that lists only buttons cannot show
    // whether it is there or whether the phase reaches it. Inputs and
    // text areas that carry a data- name are listed in the same rows, in
    // the same "on"/"off" shape, after the buttons.
    for (const m of html.matchAll(/<(input|textarea)\b([^>]*?)\/?>/g)) {
      const attrs = m[2];
      const data = [...attrs.matchAll(/data-([a-z-]+)(?:="([^"]*)")?/g)]
        .map((d) => d[1] + (d[2] && d[2] !== "true" ? "=" + d[2] : ""))
        .join(" ");
      if (!data) continue;
      buttons.push((/\bdisabled(=""|\b)/.test(attrs) ? "off " : "on  ") + data);
    }
    tabs[tab] = buttons;
  }
}
/**
 * What the not-needed reason box actually sends, for reasons worth asking
 * about. The rule is driven here rather than described: a static render
 * throws every handler away, so listing the control without exercising it
 * would say a box exists and nothing about what pressing it does.
 *
 * Each row is the message posted for that input, or null when the press
 * posts nothing at all.
 */
const gestures: Record<string, unknown> = {};
for (const reason of ["", "   ", "\t\n ", "no user-facing change", "  padded reason  "]) {
  const sent: { action: "waive-docs"; text: string }[] = [];
  submitDocsWaiver(reason, (msg) => sent.push(msg));
  gestures[JSON.stringify(reason)] = sent[0] ?? null;
}
// Under a key no phase can have, so the table stays a map of phases and
// nothing reading it by phase has to know this is here.
out["gestures:waive-docs"] = gestures;

/**
 * The actions this surface treats as shaping, as the surface itself
 * reports them.
 *
 * The phase table and this list must name the same actions. Recovering
 * the names with a regex over vscode.ts source text made that comparison
 * pass without executing the surface at all — green for a stub that
 * spells the same names. Carried here, the set is read from the running
 * module, and this harness is the one place the extension's build can
 * reach it from: the surface is TSX under its own rootDir.
 */
out["shaping:actions"] = [...SHAPING_ACTIONS];

process.stdout.write(JSON.stringify(out, null, 1));
