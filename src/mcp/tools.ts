/**
 * The tools a server offers, each naming the boundary action it performs.
 *
 * The `action` is not decoration: it is what the boundary is consulted
 * about before the tool runs. A tool whose action nobody declared is
 * refused, so adding one here without deciding who owns it yields a locked
 * door rather than a silent new power.
 */
import type { TandemSession } from "../surfaces/session";
import { theLook } from "../run/theLook";
import type { EnabledProject } from "../core/identity";
import { phaseOf, allowedNow } from "../surfaces/phase";
import { docsDuty } from "../core/docsDuty";
import * as path from "node:path";
import { knownSpaces, storeRootOf } from "./attach";
import { createProduct, listProducts } from "../core/identity";
import { allCards } from "../core/cards";
import { catalogOf, controlReachedBy, createAppFromTemplate } from "../hostui/templateCore";
import { requestStop } from "../run/record";

export interface ToolCall {
  session: TandemSession;
  project: EnabledProject;
  storeDir: string;
  args: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  /** The boundary action this performs. */
  action: string;
  /** True when the tool answers without opening a space — listing what
   *  spaces exist cannot itself require naming one. */
  spaceless?: boolean;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(c: ToolCall): Promise<string> | string;
}

/** Which space to act on. Named per call so one server serves them all. */
const WHERE = {
  space: { type: "string", description: "the thinking space's name, as list_spaces reports it" },
  repo: { type: "string", description: "the project directory; omitted when the server has a default" },
};
const IN_SPACE = { type: "object" as const, properties: { ...WHERE }, required: ["space"] };

function str(c: ToolCall, key: string): string {
  const v = c.args[key];
  return typeof v === "string" ? v : "";
}

/** The space as a person would want it summarised: what was asked, what
 *  the machine made of it, and where it stands. */
function spaceReport(c: ToolCall): string {
  const s = c.session;
  const phase = phaseOf(s);
  const cut = s.unrunCut();
  const lines = [
    `space: ${c.project.card.label} — phase ${phase}`,
    `asks: ${s.space.asks.length} · promises: ${s.space.nodes.length} · cuts: ${s.space.cuts.length} · deliveries: ${s.space.deliveries.length}`,
    `you can act on: ${allowedNow(phase).join(", ") || "nothing"}`,
  ];
  const open = s.space.questions.filter((q) => !q.decided);
  if (open.length) lines.push(`open questions (${open.length}): ${open.map((q) => q.text).join(" · ")}`);
  if (cut) {
    const c2 = s.space.cuts.find((x) => x.id === cut.id);
    const duty = c2 ? docsDuty(s.space, c2) : undefined;
    lines.push(
      `signed and unrun: ${cut.tepId ?? cut.id}` +
        (duty ? ` · documentation ${duty.state}${duty.landings.length ? `: ${duty.landings.join(", ")}` : ""}` : ""),
    );
    if (c2?.tepId) {
      const a = s.tepApproval(c2.tepId);
      lines.push(`approval: ${a.approved ? "valid" : `refused — ${a.reason}`}`);
    }
  }
  lines.push("");
  lines.push("asks:");
  for (const a of s.space.asks) lines.push(`  · ${a.text}`);
  return lines.join("\n");
}

function runReport(c: ToolCall): string {
  const v = c.session.runState?.view();
  if (!v) return "no run has been recorded for this space";
  const rows = v.units.map(
    (u) => `  ${u.state.padEnd(8)} ${u.role.padEnd(8)} ${u.id}${u.what ? ` — ${u.what.split("\n")[0].slice(0, 90)}` : ""}`,
  );
  return [
    `run ${v.runId ?? "?"} — ${c.session.running ? "in flight" : "not running"}`,
    `units: ${v.units.length}`,
    ...rows,
    c.session.runNote ? `\nnote: ${c.session.runNote}` : "",
  ].join("\n");
}

function deliveryReport(c: ToolCall): string {
  const d = c.session.space.deliveries[c.session.space.deliveries.length - 1];
  if (!d) return "no delivery yet";
  const proofs = (d.proofs ?? []).map(
    (p) => `  ${p.verdict.padEnd(6)} ${p.label}${p.ref ? ` — ${p.ref}` : ""}`,
  );
  return [
    `delivery for ${d.cutId}${d.withheld ? ` — WITHHELD: ${d.withheld}` : ""}`,
    d.acceptedAt ? `accepted ${d.acceptedAt}` : "awaiting your accept",
    `proofs (${proofs.length}):`,
    ...proofs,
    ...(d.findings?.length ? ["", "findings for you to weigh:", ...d.findings.map((f) => `  · ${f}`)] : []),
  ].join("\n");
}

export function toolTable(): ToolDef[] {
  return [
    {
      name: "list_products",
      action: "read-space",
      spaceless: true,
      description:
        "The products the store knows, and which repositories sit under each. A product is the thing being made; a repository is one place its code lives.",
      inputSchema: { type: "object", properties: {} },
      run: () => {
        const root = storeRootOf();
        const cards = allCards(root);
        const names = listProducts(root, cards.map((c) => ({ card: c })) as never);
        if (!names.length) return "no products yet — make one with new_product";
        return names
          .map((n) => {
            const under = cards.filter((c) => c.product === n);
            return (
              `${n}\n` +
              (under.length
                ? under.map((c) => `    · ${c.label}${c.at ? ` — ${c.at}` : ""}`).join("\n")
                : "    (nothing under it yet)")
            );
          })
          .join("\n");
      },
    },
    {
      name: "new_product",
      action: "new-product",
      spaceless: true,
      description:
        "Make a product — the thing being built, which repositories are then filed under. Naming it is all this does; nothing is created anywhere else.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "what the product is called, in your words" } },
        required: ["name"],
      },
      run: (c) => {
        const name = str(c, "name");
        const r = createProduct(storeRootOf(), name);
        return r.ok ? `product "${name}" made — nothing is filed under it yet` : r.reason;
      },
    },
    {
      name: "list_templates",
      action: "read-space",
      spaceless: true,
      description:
        "The starting points the platform offers for a new application, from its own catalog. Each has a url, which new_app names.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const auth = controlReachedBy();
        if ("reason" in auth) return auth.reason;
        try {
          const catalog = await catalogOf(auth);
          if (!catalog.length) return "the catalog is empty";
          return catalog
            .map((t) => `${t.name}\n    ${t.description ?? "(no description)"}\n    ${t.url}`)
            .join("\n");
        } catch (e) {
          return `the catalog could not be read: ${String(e).slice(0, 200)}`;
        }
      },
    },
    {
      name: "new_app",
      action: "new-project",
      spaceless: true,
      description:
        "Make a new application from a template: the platform creates the repository with its CI, it is cloned into the apps folder, and it is filed under a product. Minutes, not seconds — it waits for the platform to finish.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "the application's name — lowercase letters, digits and dashes; it becomes the repository name",
          },
          product: { type: "string", description: "the product it is filed under, as list_products reports it" },
          template_url: { type: "string", description: "which starting point, as list_templates reports it" },
          description: { type: "string", description: "one line: what this application is" },
        },
        required: ["name", "product", "template_url"],
      },
      run: async (c) => {
        const auth = controlReachedBy();
        if ("reason" in auth) return auth.reason;
        const said: string[] = [];
        const made = await createAppFromTemplate({
          auth,
          appName: str(c, "name"),
          product: str(c, "product"),
          templateUrl: str(c, "template_url"),
          description: str(c, "description"),
          appsRoot: path.join(process.env.HOME ?? "~", "apps"),
          storeRoot: storeRootOf(),
          say: (l) => said.push(l),
        });
        return made.ok
          ? `${made.said}\n\n${said.join(" · ")}`
          : `it was not made: ${made.reason}${said.length ? `\n\n${said.join(" · ")}` : ""}`;
      },
    },
    {
      name: "list_spaces",
      action: "read-space",
      spaceless: true,
      description:
        "Every enabled project the store knows and the thinking spaces filed under each. Start here: the other tools name a space.",
      inputSchema: { type: "object", properties: {} },
      run: () =>
        knownSpaces()
          .map(
            (p) =>
              `${p.label} (${p.project})${p.at ? ` at ${p.at}` : ""}\n` +
              (p.spaces.length ? p.spaces.map((s) => `    · ${s}`).join("\n") : "    (no spaces yet)"),
          )
          .join("\n") || "the store knows no enabled project",
    },
    {
      name: "read_space",
      action: "read-space",
      description:
        "The thinking space: its asks, how many promises were derived, what phase it is in, open questions, and whether a signed cut is waiting.",
      inputSchema: IN_SPACE,
      run: spaceReport,
    },
    {
      name: "read_run",
      action: "read-run",
      description: "The current or last run: every unit and its state, and the run's note.",
      inputSchema: IN_SPACE,
      run: runReport,
    },
    {
      name: "look_at",
      action: "look-at",
      description:
        "Open something already deployed and say what a person would notice: whether it is blank, " +
        "whether anything can be pressed, whether a page is drawn with no height, and what the page threw. " +
        "Findings only — it withholds nothing and fails nothing.",
      inputSchema: {
        type: "object",
        properties: {
          ...WHERE,
          url: { type: "string", description: "what to open — the deployed thing's address" },
          ask: { type: "string", description: "what this look is about, in your words" },
        },
        required: ["space", "url"],
      },
      run: async (c) => {
        const r = await theLook({ url: str(c, "url"), ...(str(c, "ask") ? { ask: str(c, "ask") } : {}) });
        if (!r.looked) return `could not look: ${r.why}`;
        return r.findings.length
          ? [`${r.findings.length} thing(s) a person would notice:`, ...r.findings.map((f) => `  · ${f.said}`)].join("\n")
          : "nothing to say — it opened, it has content, and every page has a size.";
      },
    },
    {
      name: "read_delivery",
      action: "read-delivery",
      description: "The latest delivery: its proofs, its findings, and whether it was withheld.",
      inputSchema: IN_SPACE,
      run: deliveryReport,
    },
    {
      name: "read_log",
      action: "read-log",
      description: "The tail of a step's log. Give the step id, or omit it for the run's own log.",
      inputSchema: { type: "object", properties: { ...WHERE, step: { type: "string" } }, required: ["space"] },
      run: (c) => {
        c.session.readLog(str(c, "step") || null);
        const v = c.session.logView();
        return typeof v === "string" ? v : JSON.stringify(v, null, 2);
      },
    },
    {
      name: "save_draft",
      action: "save-draft",
      description:
        "Put text in the capture box, one ask per line. This DRAFTS only — turning drafted words into asks is the person's act, and this server cannot do it.",
      inputSchema: { type: "object", properties: { ...WHERE, text: { type: "string" } }, required: ["space", "text"] },
      run: (c) => {
        c.session.saveDraft(str(c, "text"));
        return `drafted ${str(c, "text").split("\n").filter((l) => l.trim()).length} line(s) — the person keeps them, or does not`;
      },
    },
    {
      name: "reground",
      action: "reground",
      description: "Read the code again and re-place every promise that has drifted.",
      inputSchema: IN_SPACE,
      run: async (c) => {
        await c.session.reground();
        return "re-grounded";
      },
    },
    {
      name: "rerun",
      action: "rerun",
      description:
        "Start the signed work again and return at once. A run takes an hour; watch it with read_run. Refused when nothing is signed, or a run is in flight.",
      inputSchema: IN_SPACE,
      run: (c) => {
        // STARTED, not awaited. session.rerun() resolves when the whole
        // build ends, so awaiting it here holds the tool call open for the
        // length of the run and the client abandons it — while the run
        // itself carries on, unreachable. What the caller needs back is
        // that it began; read_run says the rest.
        if (c.session.running) return "refused: a run is already in flight";
        if (!c.session.unrunCut()) return "refused: there is no signed work waiting to run";
        void c.session.rerun();
        return "run started — watch it with read_run; it takes about an hour";
      },
    },
    {
      name: "full_rerun",
      action: "rerun",
      description:
        "Start the signed work again FROM NOTHING: the branch an earlier run left is discarded — kept under a `discarded/…` tag — so every unit runs again on the base as it stands today. A plain rerun resumes instead, standing on the slices an earlier run committed. Use this when the machinery itself changed under the last run. Refused when nothing is signed, or a run is in flight.",
      inputSchema: IN_SPACE,
      run: (c) => {
        if (c.session.running) return "refused: a run is already in flight";
        if (!c.session.unrunCut()) return "refused: there is no signed work waiting to run";
        void c.session.rerun(true);
        return "run started from nothing — the earlier branch is discarded and tagged; watch it with read_run";
      },
    },
    {
      name: "stop_run",
      action: "stop-run",
      description:
        "Ask the run to stop, whoever is driving it. The process that owns the run reads the request and ends itself.",
      inputSchema: IN_SPACE,
      run: (c) => {
        const cut = c.session.unrunCut();
        if (!cut) return "there is no run to stop";
        // Written, not called: the run may be driven by another process,
        // and one process must never reach into another's to end it.
        const asked = requestStop(c.storeDir, cut.id, new Date().toISOString());
        if (c.session.running) c.session.runState?.halt();
        return asked
          ? "stop asked for — the run ends at its next heartbeat"
          : "could not write the stop request; no run record to ask";
      },
    },
    {
      name: "answer_worker",
      action: "answer-worker",
      description: "Answer a parked worker's question, by unit id.",
      inputSchema: {
        type: "object",
        properties: { ...WHERE, unit: { type: "string" }, text: { type: "string" } },
        required: ["space", "unit", "text"],
      },
      run: (c) =>
        c.session.answerWorker(str(c, "unit"), str(c, "text"))
          ? `answered ${str(c, "unit")}`
          : `no worker is parked as ${str(c, "unit")}`,
    },
  ];
}
