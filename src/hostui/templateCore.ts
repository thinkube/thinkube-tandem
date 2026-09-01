/**
 * Making an application from the platform's template catalog, with nobody
 * watching.
 *
 * This was one function with the pickers baked through it: choose a
 * template from a quick pick, type a name in an input box, watch a progress
 * notification, and somewhere inside all that, instantiate a real
 * repository. Which meant a person clicking a tree was the only way it
 * could ever happen — there was no seam a machine could reach.
 *
 * So the work is here and the asking is not. What is left in the editor's
 * flow is three questions and a progress bar; what is here creates the
 * repository, waits for the platform to finish, clones it, and files it
 * under a product. Every effect on the world happens in this file, and it
 * takes no VS Code at all.
 *
 * It talks rather than throws: `say` is how a caller follows a thing that
 * takes minutes, and the result says what happened in one sentence.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument } from "yaml";
import { mintCard } from "../core/identity";

export interface ControlAuth {
  base: string;
  token: string;
}

export interface CatalogTemplate {
  name: string;
  description?: string;
  url: string;
  deployment_type?: string;
}

/** How the platform is asked. Injectable so a drive never reaches it. */
export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export type Made =
  | { ok: true; cardId: string; at: string; said: string; url?: string }
  | { ok: false; reason: string };

/** Dig the control URL + bearer token out of a Claude MCP config. */
function parseControlAuth(config: unknown): ControlAuth | undefined {
  const dig = (o: unknown): ControlAuth | undefined => {
    if (typeof o !== "object" || o === null) return undefined;
    const rec = o as Record<string, unknown>;
    const entry = rec["thinkube-control"] as
      | { url?: string; headers?: Record<string, string> }
      | undefined;
    const auth = entry?.headers?.Authorization;
    if (entry?.url && auth?.startsWith("Bearer "))
      return { base: new URL(entry.url).origin, token: auth.slice("Bearer ".length) };
    for (const v of Object.values(rec)) {
      const r = dig(v);
      if (r) return r;
    }
    return undefined;
  };
  return dig(config);
}

/**
 * How anything outside the editor reaches control: the credential the
 * thinkube-control MCP server was configured with. The editor has its own
 * settings and prefers those; a server, a script or a tool has only this.
 */
export function controlReachedBy(
  home = process.env.HOME ?? "~",
): ControlAuth | { reason: string } {
  try {
    const parsed = parseControlAuth(
      JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8")),
    );
    if (parsed) return parsed;
  } catch {
    /* fall through to the refusal */
  }
  return {
    reason:
      "no way to reach thinkube-control — connect the thinkube-control MCP server, or set thinkubeTandem.controlUrl and controlToken in the editor",
  };
}

/** The applications the catalog offers. A template with another deployment
 *  type is not one of these and is left out rather than offered and
 *  refused later. */
export async function catalogOf(auth: ControlAuth, http: Http = fetch): Promise<CatalogTemplate[]> {
  const res = await http(`${auth.base}/api/v1/templates/list`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!res.ok) throw new Error(`the template catalog answered ${res.status}`);
  const raw = (await res.json()) as { templates?: CatalogTemplate[] };
  return (raw.templates ?? []).filter((t) => (t.deployment_type ?? "app") === "app");
}

/** The credential-bearing clone URL, following the pod's own convention —
 *  read from a sibling application's origin, never invented. */
function cloneUrlFor(appsRoot: string, appName: string): string {
  try {
    for (const e of fs.readdirSync(appsRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const cfg = path.join(appsRoot, e.name, ".git", "config");
      const m = /url = (https:\/\/[^\n]*git\.[^\n/]+\/[^\n/]+)\/[^\n/]+\.git/.exec(
        fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8") : "",
      );
      if (m) return `${m[1]}/${appName}.git`;
    }
  } catch {
    /* fall through to the convention */
  }
  return `https://git.thinkube.com/thinkube-deployments/${appName}.git`;
}

/** A name the platform will accept as a repository name. Refused here, with
 *  the rule said, rather than by the forge several minutes later. */
export function nameIsUsable(name: string): string | undefined {
  return /^[a-z][a-z0-9-]{1,38}$/.test(name)
    ? undefined
    : "lowercase letters, digits and dashes, starting with a letter — it becomes the repository name";
}

/**
 * Write down where the new application will be seen, in its own file.
 *
 * `thinkube.yaml` grew a `deploy` block and nothing ever filled it in, so
 * every repository was left to a filesystem guess about how it reaches
 * production. Creation is the one moment somebody knows: the platform just
 * made an app, an app is deployed by being pushed, and its address follows
 * from the name it was given. Recorded here, nothing has to infer it later.
 *
 * `parseDocument` rather than parse-and-restringify, because a template's
 * own file carries comments and losing them to a machine's edit is the kind
 * of damage nobody notices until they go looking for the explanation.
 *
 * A file that already says how it deploys is left exactly as it is: the
 * repository's own answer beats one derived from a clone URL.
 */
export function sayWhereItLives(repoRoot: string, appName: string, cloneUrl: string): string | undefined {
  const domain = /https:\/\/[^\n/]*git\.([^\n/]+)\//.exec(cloneUrl)?.[1];
  if (!domain) return undefined;
  const at = `https://${appName}.${domain}`;
  const file = path.join(repoRoot, "thinkube.yaml");
  let doc;
  try {
    doc = parseDocument(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (doc.getIn(["spec", "deploy"]) !== undefined) return undefined;
  doc.setIn(["spec", "deploy", "at"], at);
  try {
    fs.writeFileSync(file, String(doc));
  } catch {
    return undefined;
  }
  return at;
}

/**
 * Create the application, wait for the platform to finish, clone it, and
 * file it under its product.
 *
 * A folder already at the destination is refused up front with the cure
 * named: the platform's git step pushes the wrong branch over a leftover
 * checkout, which cost a real application its history once.
 */
export async function createAppFromTemplate(a: {
  auth: ControlAuth;
  product: string;
  appName: string;
  templateUrl: string;
  description?: string;
  appsRoot: string;
  storeRoot: string;
  say?: (line: string) => void;
  http?: Http;
  sleep?: (ms: number) => Promise<void>;
  clone?: (url: string, dest: string) => Promise<void>;
  /** How long to wait for the platform, in polls of five seconds. */
  patience?: number;
}): Promise<Made> {
  const say = a.say ?? ((): void => {});
  const http = a.http ?? fetch;
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref()));

  const bad = nameIsUsable(a.appName);
  if (bad) return { ok: false, reason: bad };

  const dest = path.join(a.appsRoot, a.appName);
  if (fs.existsSync(dest))
    return {
      ok: false,
      reason: `${dest} already exists — delete that folder or pick another name; the platform will not deploy over it`,
    };

  say(`asking the platform for "${a.appName}" from ${a.templateUrl}`);
  let deploymentId: string;
  try {
    const res = await http(`${a.auth.base}/api/v1/templates/deploy-async`, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        template_url: a.templateUrl,
        template_name: a.appName,
        variables: { project_description: a.description ?? "" },
        execution_mode: "background",
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    deploymentId = ((await res.json()) as { deployment_id: string }).deployment_id;
  } catch (e) {
    return { ok: false, reason: `the platform refused to make it: ${String(e).slice(0, 300)}` };
  }

  const patience = a.patience ?? 180;
  for (let i = 0; i < patience; i++) {
    await sleep(5000);
    try {
      const res = await http(`${a.auth.base}/api/v1/templates/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${a.auth.token}` },
      });
      if (!res.ok) continue;
      const st = (await res.json()) as { status: string; output?: string };
      say(st.status);
      if (st.status === "completed") break;
      if (["failed", "cancelled", "error"].includes(st.status))
        return { ok: false, reason: `it did not finish: ${(st.output ?? st.status).slice(-600)}` };
    } catch {
      /* transient — keep asking */
    }
    if (i === patience - 1)
      return { ok: false, reason: "the platform did not finish in time — look in thinkube-control" };
  }

  if (!fs.existsSync(dest)) {
    say(`cloning it into ${dest}`);
    const clone =
      a.clone ??
      ((url: string, to: string) =>
        new Promise<void>((resolve, reject) =>
          execFile("git", ["clone", url, to], (err) => (err ? reject(err) : resolve())),
        ));
    try {
      await clone(cloneUrlFor(a.appsRoot, a.appName), dest);
    } catch (e) {
      return {
        ok: false,
        reason: `it exists on the forge but could not be cloned: ${String(e).slice(0, 200)}`,
      };
    }
  }
  if (!fs.existsSync(dest)) return { ok: false, reason: "it was made but nothing arrived on disk" };

  const minted = mintCard(dest, { label: a.appName, product: a.product }, a.storeRoot);
  if (!minted.ok) return { ok: false, reason: minted.reason };
  const url = sayWhereItLives(dest, a.appName, cloneUrlFor(a.appsRoot, a.appName));
  if (url) say(`it will be seen at ${url}, and its own file now says so`);
  return {
    ok: true,
    cardId: minted.card.id,
    at: dest,
    ...(url ? { url } : {}),
    said:
      `"${a.appName}" exists on the forge, is cloned to ${dest}, and is filed under ${a.product}` +
      (url ? `. It will be seen at ${url}` : ""),
  };
}
