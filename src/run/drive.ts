/**
 * Judging a promise on the running product.
 *
 * Rule 1 says a criterion must be drivable from outside the product. For
 * anything about a page, the outside is a browser: the only honest way to
 * know that a person can add a task and see it in the list is to open the
 * address and do it. Code review cannot show it, and a check that reaches
 * inside the product to assert it proves nothing about the product.
 *
 * So a criterion only the running product can show is not handed back to
 * the person to certify by hand. Once the work is merged, built and
 * answering, a driver opens the address and judges it there.
 *
 * The driver is held to three limits:
 *   - it cannot write anything: no repository is opened to it, and no
 *     tool that edits or runs commands is offered;
 *   - it carries no credentials: it gets the address and nothing else;
 *   - it may open one address: the browser refuses every other origin.
 *
 * Its word is GREEN or RED with one line. A driver that never answers, or
 * a browser that never starts, leaves the criterion unjudged — never a
 * pass nobody saw, and never a red the work did not earn.
 */
import { theModel } from "../engine/theModel";
import * as fs from "node:fs";
import * as path from "node:path";
import { Proof } from "../core/schema";
import { Finding, findingsIn } from "./findings";
import { collectText } from "../derive/round";

/** What a driver is asked to settle: one promise, and the criteria that
 *  say what it means. They are judged in one session, on one product. */
export interface ToDrive {
  /** The promise, in the person's own words. */
  promise: string;
  /** Its criteria, as signed — the script the reviewer follows. */
  criteria: { id?: string; text: string }[];
  /** The ask that wanted it, when there is one. */
  ask?: string;
}

export interface DriveArgs {
  /** Where the product answers. The only address the driver may open. */
  at: string;
  model: string;
  /** A browser of this reviewer's own, already listening. One each: they
   *  work at the same time, and a shared one collects everybody's tabs. */
  browserAt: string;
  /** Which reviewer this is, for its own lines in the log. */
  who?: string;
  /** Where a reviewer's own lines go: under its own card, by its id, so
   *  three reviewers do not interleave into one stream nobody can read. */
  logFor?: (who: string, line: string) => void;
  /** Where the browser writes its pictures, so each verdict can carry the
   *  ones taken for it. */
  looksIn?: string;
  log?: (line: string) => void;
  /** Injectable for tests: the SDK stream, already shaped. */
  ask?: (prompt: string, options: Record<string, unknown>) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
  /** The run's stop signal: it ends the round in flight and the loop
   *  around it, so Stop reaches a reviewer like every other actor. */
  stop?: AbortSignal;
  abort?: AbortController;
}

/**
 * How much work a reviewer does between check-ins.
 *
 * Not a budget it is expected to bump into: it is how far it goes before
 * the machine looks in and asks whether it has answered. Set high enough
 * that an ordinary promise is judged in one round, because every check-in
 * costs a reconnection to the browser and a fresh start on the page.
 */
const TURNS_PER_ROUND = 200;
/**
 * The backstop, and only that: a reviewer that keeps acting and never
 * answers is not converging on anything.
 */
const RUNAWAY = 6;

/**
 * What a reviewer may do in the browser: open a page, look at it, act on
 * it, and take a picture. Named one by one rather than by server, so a
 * tool the server adds is not granted by default — and never the one that
 * runs arbitrary code in the server's own process.
 */
const BROWSER_TOOLS = [
  "mcp__browser__browser_navigate",
  "mcp__browser__browser_navigate_back",
  "mcp__browser__browser_snapshot",
  "mcp__browser__browser_find",
  "mcp__browser__browser_click",
  "mcp__browser__browser_type",
  "mcp__browser__browser_fill_form",
  "mcp__browser__browser_press_key",
  "mcp__browser__browser_hover",
  "mcp__browser__browser_drag",
  "mcp__browser__browser_drop",
  "mcp__browser__browser_select_option",
  "mcp__browser__browser_handle_dialog",
  "mcp__browser__browser_wait_for",
  "mcp__browser__browser_evaluate",
  "mcp__browser__browser_take_screenshot",
  "mcp__browser__browser_console_messages",
  "mcp__browser__browser_network_requests",
  "mcp__browser__browser_resize",
  "mcp__browser__browser_tabs",
  "mcp__browser__browser_close",
];

/** The one origin the browser will open, in the form it wants it. */
export function originOf(at: string): string {
  try {
    const u = new URL(at);
    return `${u.protocol}//${u.host}`;
  } catch {
    return at;
  }
}

/**
 * The reviewer's word for one criterion, from a reply that answers them
 * all: the last line that names that criterion by its number.
 */
function verdictFor(
  reply: string | null | undefined,
  ord: number,
): { verdict: "GREEN" | "RED" | "BLOCKED"; said: string } | undefined {
  if (!reply) return undefined;
  const lines = reply.split(/\r?\n/).map((l) => l.trim().replace(/^[*_`#>\-\s]+/, ""));
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = new RegExp(`^${ord}[).:\\s]+\\s*(GREEN|RED|BLOCKED)\\b[:\\s—-]*(.*)$`, "i").exec(lines[i]);
    if (m) return { verdict: m[1].toUpperCase() as "GREEN" | "RED" | "BLOCKED", said: (m[2] ?? "").trim() };
  }
  return undefined;
}



async function drive(
  a: DriveArgs,
  prompt: string,
  turns: number,
  withBrowser = true,
  session?: { id?: string },
): Promise<string | null> {
  const ask =
    a.ask ??
    (async (p: string, options: Record<string, unknown>) => {
      const mod = (await theModel("the driver of the running product")) as {
        query: (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown>;
      };
      return mod.query({ prompt: p, options });
    });
  return collectText(
    () =>
      ({
        [Symbol.asyncIterator]: async function* () {
          // The round in flight ends on the run's own signal.
          const ownAbort = a.abort ?? new AbortController();
          if (a.stop) {
            if (a.stop.aborted) ownAbort.abort();
            else a.stop.addEventListener("abort", () => ownAbort.abort(), { once: true });
          }
          const stream = await ask(prompt, {
            model: a.model,
            abortController: ownAbort,
            permissionMode: "bypassPermissions",
            // Asked about every call, so what a reviewer may do is a short
            // list rather than the absence of a long one: a tool nobody
            // thought of is refused because it is not named here.
            canUseTool: async (tool: string) =>
              (withBrowser ? BROWSER_TOOLS : ([] as string[])).includes(tool)
                ? { behavior: "allow" as const }
                : {
                    behavior: "deny" as const,
                    message:
                      `${tool} is not yours to use. You judge the product through the browser you were given, ` +
                      `and nothing else: no shell, no files, no other machine. If the browser cannot reach it, ` +
                      `say BLOCKED.`,
                  },
            thinking: { type: "adaptive" },
            effort: "high",
            maxTurns: turns,
            ...(session?.id ? { resume: session.id } : {}),
            ...(withBrowser ? { mcpServers: { browser: { type: "http", url: a.browserAt } } } : { mcpServers: {} }),
            // Only this browser. Without it the machine's own browser
            // server is inherited too, and that one carries no session and
            // is held to no origin.
            strictMcpConfig: true,
            // The browser and nothing else: no file, no command, no
            // network tool of its own. A driver that could read the
            // repository would judge the code again instead of the product.
            allowedTools: withBrowser ? [...BROWSER_TOOLS] : [],
            disallowedTools: [
              // Arbitrary code in the browser server's own process, which
              // runs as the person: it would reach the repository, the
              // machine and every address, whatever the limits above say.
              "mcp__browser__browser_run_code_unsafe",
              "mcp__browser__browser_file_upload",
              // The machine's own browser server, named, in case anything
              // but the flag above lets it through.
              "mcp__playwright",
              "Read",
              "Grep",
              "Glob",
              "Write",
              "Edit",
              "NotebookEdit",
              "Bash",
              "WebFetch",
              "WebSearch",
              "Task",
              "AskUserQuestion",
              "ExitPlanMode",
            ],
            additionalDirectories: [],
          });
          for await (const m of stream) {
            // The session this round belongs to, so the next one continues
            // it rather than starting a conversation with no memory of the
            // page it is standing on.
            const said = m as { session_id?: string };
            if (session && said.session_id) session.id = said.session_id;
            yield m;
          }
        },
      }) as AsyncIterable<unknown>,
    a.log,
  );
}

/**
 * Judge one criterion on the running product. The proof carries the
 * address, so a reader can go and look at the same thing the driver did.
 */
export async function driveOne(a: DriveArgs, c: ToDrive, ord: number): Promise<Proof[] & { noticed?: Finding[] }> {
  a.log?.(`on the running product ${ord}: opening ${a.at} — ${c.criteria.length} thing(s) to check`);
  // One conversation for this reviewer, from first look to last word.
  const session: { id?: string } = {};
  const reply = await drive(
    a,
    [
      "You are an INDEPENDENT REVIEWER judging ONE promise about a running",
      "product. You have a browser and nothing else: you cannot read the",
      "code, and you must not try. What the product does in front of you is",
      "the only evidence.",
      "",
      `THE ADDRESS: ${a.at} — the only address you may open.`,
      ...(c.ask ? [`THE ASK (the person's words): ${c.ask}`] : []),
      `THE PROMISE: ${c.promise}`,
      "",
      "WHAT YOU ARE JUDGING, one by one:",
      ...c.criteria.map((x, i) => `${i + 1}. ${x.text}`),
      "",
      "Open the address once and check them in order, doing what each one",
      "describes. Build whatever you need through the product itself — make",
      "a task before you open the box that needs one.",
      "",
      "Name everything you create so a person can recognise it later:",
      "start every name you type with `tandem check ·`. Before you answer,",
      "delete everything you created where the product offers a way; what it",
      "does not let you remove, say in a last line beginning LEFT BEHIND:.",
      "",
      "Anything already named `tandem check ·` is this machinery: another",
      "reviewer working beside you now, or a leftover of an earlier run. It",
      "is never a finding and never evidence about the product — ignore",
      "those items, never delete them, and never count them in what you",
      "judge.",
      "",
      "Anything already named `tandem check ·` is this machinery: another",
      "reviewer working beside you now, or one from an earlier run. It is",
      "never a finding and never evidence about the product — ignore those",
      "items, never delete them, and never count them in what you judge.",
      "",
      "The product is in use and holds other people's things. Judge what you",
      "did and what you saw of it, never the state of the whole product: if a",
      "criterion only holds in an empty product, say so rather than failing",
      "it.",
      "",
      "If you cannot reach the thing at all — a sign-in page with no way",
      "through, the address does not answer, the page never loads — you have",
      "judged nothing. Answer BLOCKED for those items, never RED: RED means",
      "you did the thing and the product did not do what was promised.",
      "",
      "For each item you must SAVE A PICTURE with browser_take_screenshot at",
      "the moment you decide it. A page snapshot is not a picture: the person",
      "reads your answer and looks at the picture, and a snapshot shows them",
      "nothing. Name each one for the item it belongs to and what it shows:",
      "  <item number>-<three to six words, hyphenated>.png",
      "for example `2-empty-title-message-shown.png`, and name that file in",
      "the answer line for that item. Take more than one when the story needs",
      "it.",
      "",
      "Leave the product as you found it where you can.",
      "",
      "You will see things that are not what you were asked to judge — a",
      "word that is wrong, a control that behaves oddly, something half",
      "done. Do not judge them here and do not act on them: write each one",
      "in one line —",
      "FINDING: <what you saw and where> | ASK: <one sentence asking for",
      "what a person would want instead, in their words>",
      "— you are the one who saw it, so you draft the ask; the person keeps",
      "it or does not.",
      "",
      "Answer with ONE LINE PER ITEM at the end, numbered as above:",
      "1. GREEN <what you did and what you saw>",
      "2. RED <what you did and what happened instead>",
      "3. BLOCKED <what stopped you reaching it>",
    ].join("\n"),
    TURNS_PER_ROUND,
    true,
    session,
  );
  // It works until it has answered, not until a counter runs out. Asked
  // to carry on while each round brings something new; stopped when one
  // adds nothing, and then asked once, without the browser, to say what
  // it found — so work already done becomes verdicts rather than silence.
  const allAnswered = (text: string | null): boolean => c.criteria.every((_, i) => verdictFor(text, i + 1));
  const answeredCount = (text: string | null): number =>
    c.criteria.filter((_, i) => verdictFor(text, i + 1)).length;
  let finished = reply;
  let last = reply ?? "";
  let answered = answeredCount(finished);
  for (let more = 0; !allAnswered(finished) && more < RUNAWAY && !a.stop?.aborted; more++) {
    a.log?.(`on the running product ${ord}: still working, no answer yet — asking it to carry on`);
    const again = await drive(
      a,
      [
        "You have not answered every item yet. What you have already done",
        "stands — do not repeat it. Finish what is left and then give your",
        "numbered lines: GREEN, RED, or BLOCKED for anything you could not",
        "reach.",
        "",
        "WHAT YOU ARE JUDGING:",
        ...c.criteria.map((x, i) => `${i + 1}. ${x.text}`),
        "",
        "WHAT YOU HAVE WRITTEN SO FAR:",
        last.slice(-6000),
      ].join("\n"),
      TURNS_PER_ROUND,
      true,
      session,
    );
    // It stops when a round answers nothing new. Comparing the text itself
    // never converged: a reviewer that repeats its work says it slightly
    // differently every time.
    if (!again) break;
    const now = answeredCount(again);
    last = again;
    finished = again;
    if (now <= answered) break;
    answered = now;
  }
  if (!allAnswered(finished) && (finished ?? "").trim() && !a.stop?.aborted)
    finished =
      (await drive(
        a,
        [
          "Answer now from what you found — no browser, no further looking.",
          "",
          "WHAT YOU WERE JUDGING:",
          ...c.criteria.map((x, i) => `${i + 1}. ${x.text}`),
          "",
          "WHAT YOU WROTE WHILE YOU WERE THERE:",
          (finished ?? "").slice(-6000),
          "",
          "ONE LINE PER ITEM, numbered as above: GREEN, RED, or BLOCKED",
          "when you never reached it, each with what you did and saw.",
        ].join("\n"),
        3,
        false,
        session,
      )) ?? finished;
  // What it saw that nobody asked about, in its own words.
  const noticed = findingsIn(finished ?? "");
  for (const f of noticed) a.log?.(`noticed: ${f.saw}`);
  const proofs = c.criteria.map((x, i) => {
    const answer = verdictFor(finished, i + 1);
    const label = x.text;
    if (!answer) {
      a.log?.(`on the running product ${ord}.${i + 1}: no answer came back — it stays unjudged`);
      return {
        kind: "assessment" as const,
        label,
        verdict: "unjudged" as const,
        ref: `no answer came back about this, from ${a.at}`,
        ...(x.id ? { criterionId: x.id } : {}),
      };
    }
    a.log?.(`on the running product ${ord}.${i + 1}: ${answer.verdict}${answer.said ? ` — ${answer.said}` : ""}`);
    // `ref` is where the report reads a failure's reason, so it carries
    // what the reviewer saw, with the address after it.
    // Blocked is not a verdict on the work: the reviewer never reached it.
    const verdict = answer.verdict === "GREEN" ? "green" : answer.verdict === "RED" ? "red" : "unjudged";
    const looks = looksFor(a.looksIn, i + 1);
    if (!looks.length && verdict !== "unjudged")
      a.log?.(`on the running product ${ord}.${i + 1}: judged with no picture saved`);
    return {
      kind: "assessment" as const,
      label,
      verdict: verdict as "green" | "red" | "unjudged",
      ...(looks.length ? { looks } : {}),
      ref:
        verdict === "unjudged"
          ? `${answer.said || "the reviewer could not reach this"} — nothing was judged, at ${a.at}`
          : answer.said
            ? `${answer.said} — seen at ${a.at}`
            : `it did not hold, at ${a.at}`,
      ...(x.id ? { criterionId: x.id } : {}),
    };
  }) as Proof[] & { noticed?: Finding[] };
  if (noticed.length) proofs.noticed = noticed;
  return proofs;
}

/**
 * The pictures a reviewer saved for one item, with what each shows.
 *
 * The name carries both: the item's number, then a few words. A file
 * named any other way belongs to no item and is left where it is.
 */
function looksFor(dir: string | undefined, ord: number): { path: string; said: string }[] {
  if (!dir) return [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => new RegExp(`^${ord}[-_]`).test(f) && /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => ({
      path: path.join(dir, f),
      said: f
        .replace(/\.(png|jpe?g)$/i, "")
        .replace(new RegExp(`^${ord}[-_]`), "")
        .replace(/[-_]+/g, " ")
        .trim(),
    }));
}

/** A criterion nobody judged because the run was stopped. */
function stoppedProof(at: string, x: { id?: string; text: string }): Proof {
  return {
    kind: "assessment",
    label: x.text,
    verdict: "unjudged",
    ref: `the run was stopped before this was judged, at ${at}`,
    ...(x.id ? { criterionId: x.id } : {}),
  };
}

/** Judge every promise, a few at a time — each waits on a browser. One
 *  list of verdicts per promise, in the order the promises were given. */
export async function driveAll(
  a: Omit<DriveArgs, "browserAt">,
  list: ToDrive[],
  ids: readonly string[] = [],
  /** A browser of its own for one reviewer, closed when it is done. */
  openOne?: (who: string) => Promise<{ url: string; close: () => void } | { why: string }>,
  atOnce = 3,
): Promise<Proof[][]> {
  const out: Proof[][] = [];
  if (a.stop?.aborted) return list.map((c) => c.criteria.map((x) => stoppedProof(a.at, x)));
  const one = async (c: ToDrive, i: number): Promise<Proof[]> => {
    const who = ids[i] ?? `${i + 1}`;
    const browser = openOne ? await openOne(who) : { url: (a as DriveArgs).browserAt, close: () => undefined };
    if ("why" in browser) {
      (a.logFor ? (l: string) => a.logFor!(who, l) : a.log)?.(`no browser — ${browser.why}`);
      return c.criteria.map((x) => ({
        kind: "assessment" as const,
        label: x.text,
        verdict: "unjudged" as const,
        ref: `no browser to judge with: ${browser.why}`,
        ...(x.id ? { criterionId: x.id } : {}),
      }));
    }
    try {
      return await driveOne(
        {
          ...a,
          browserAt: browser.url,
          who,
          ...(a.looksIn ? { looksIn: `${a.looksIn}/${who}` } : {}),
          ...(a.logFor ? { log: (l: string) => a.logFor!(who, l) } : {}),
        },
        c,
        i + 1,
      );
    } finally {
      browser.close();
    }
  };
  for (let i = 0; i < list.length; i += atOnce)
    out.push(...(await Promise.all(list.slice(i, i + atOnce).map((c, j) => one(c, i + j)))));
  return out;
}
