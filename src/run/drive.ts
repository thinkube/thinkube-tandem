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
import { Proof } from "../core/schema";
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
  /** The browser the driver reaches through, as a command to run. */
  browser?: { command: string; args: string[] };
  log?: (line: string) => void;
  /** Injectable for tests: the SDK stream, already shaped. */
  ask?: (prompt: string, options: Record<string, unknown>) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
  abort?: AbortController;
}

/**
 * How many turns a driver gets to open a page, do a thing, and look. A
 * page that needs more than this is not being judged, it is being explored.
 */
const TURNS = 40;

/** The browser, spoken to over the same protocol every other tool uses. */
function browserOf(a: DriveArgs): { command: string; args: string[] } {
  return (
    a.browser ?? {
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--headless", "--isolated", "--allowed-origins", originOf(a.at)],
    }
  );
}

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
function verdictFor(reply: string | null | undefined, ord: number): { verdict: "GREEN" | "RED"; said: string } | undefined {
  if (!reply) return undefined;
  const lines = reply.split(/\r?\n/).map((l) => l.trim().replace(/^[*_`#>\-\s]+/, ""));
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = new RegExp(`^${ord}[).:\\s]+\\s*(GREEN|RED)\\b[:\\s—-]*(.*)$`, "i").exec(lines[i]);
    if (m) return { verdict: m[1].toUpperCase() as "GREEN" | "RED", said: (m[2] ?? "").trim() };
  }
  return undefined;
}



async function drive(a: DriveArgs, prompt: string): Promise<string | null> {
  const b = browserOf(a);
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
          const stream = await ask(prompt, {
            model: a.model,
            ...(a.abort ? { abortController: a.abort } : {}),
            permissionMode: "bypassPermissions",
            thinking: { type: "adaptive" },
            effort: "high",
            maxTurns: TURNS,
            mcpServers: { browser: { command: b.command, args: b.args } },
            // The browser and nothing else: no file, no command, no
            // network tool of its own. A driver that could read the
            // repository would judge the code again instead of the product.
            allowedTools: ["mcp__browser"],
            disallowedTools: [
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
          for await (const m of stream) yield m;
        },
      }) as AsyncIterable<unknown>,
    a.log,
  );
}

/**
 * Judge one criterion on the running product. The proof carries the
 * address, so a reader can go and look at the same thing the driver did.
 */
export async function driveOne(a: DriveArgs, c: ToDrive, ord: number): Promise<Proof[]> {
  a.log?.(`on the running product ${ord}: opening ${a.at} — ${c.criteria.length} thing(s) to check`);
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
      "describes. If the page needs you to sign in and no way in is offered,",
      "every one of them is RED with that as the reason.",
      "",
      "Leave the product as you found it where you can.",
      "",
      "Answer with ONE LINE PER ITEM at the end, numbered as above:",
      "1. GREEN <what you did and what you saw>",
      "2. RED <what you did and what happened instead>",
    ].join("\n"),
  );
  return c.criteria.map((x, i) => {
    const answer = verdictFor(reply, i + 1);
    const label = `${c.promise} — ${x.text}`;
    if (!answer) {
      a.log?.(`on the running product ${ord}.${i + 1}: no answer came back — it stays unjudged`);
      return {
        kind: "assessment" as const,
        label,
        verdict: "unjudged" as const,
        ref: a.at,
        ...(x.id ? { criterionId: x.id } : {}),
      };
    }
    a.log?.(`on the running product ${ord}.${i + 1}: ${answer.verdict}${answer.said ? ` — ${answer.said}` : ""}`);
    return {
      kind: "assessment" as const,
      label: answer.said ? `${label} — ${answer.said}` : label,
      verdict: (answer.verdict === "GREEN" ? "green" : "red") as "green" | "red",
      ref: a.at,
      ...(x.id ? { criterionId: x.id } : {}),
    };
  });
}

/** Judge every promise, a few at a time — each waits on a browser. The
 *  verdicts come back grouped as they were asked: one list per promise. */
export async function driveAll(a: DriveArgs, list: ToDrive[]): Promise<Proof[][]> {
  const out: Proof[][] = [];
  const AT_ONCE = 3;
  for (let i = 0; i < list.length; i += AT_ONCE) {
    const batch = list.slice(i, i + AT_ONCE);
    out.push(...(await Promise.all(batch.map((c, j) => driveOne(a, c, i + j + 1)))));
  }
  return out;
}
