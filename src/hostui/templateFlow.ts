/**
 * Start-from-nothing (SPEC Amendment 1 §4, Option A): a new application
 * is born ONLY from the platform's template catalog. The candidates are
 * a metadata lookup (no AI); the human chooses and names; the platform's
 * own instantiation creates the real repository (Gitea + CI) the moment
 * the choice is made; the new repository is cloned into the apps root,
 * added to the workspace, enabled under the product, and attached to the
 * active project's context scope — so grounding reads INSTANTIATED code,
 * never raw template source.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { mintCard } from "../core/identity";
import { configuredStoreRoot } from "./spaceOps";
import { thinkingSpaceDirs } from "../core/spaces";
import { readContextScope, writeContextScope } from "../core/workProjects";
import { vs } from "../core/vscodeHost";

interface ControlAuth {
  base: string;
  token: string;
}

/** Pure: dig the control URL + bearer token out of a Claude MCP config. */
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

function controlAuth(): ControlAuth | { reason: string } {
  const cfg = vs().workspace.getConfiguration("thinkubeTandem");
  const url = cfg.get<string>("controlUrl", "");
  const token = cfg.get<string>("controlToken", "");
  if (url && token) return { base: new URL(url).origin, token };
  try {
    const parsed = parseControlAuth(
      JSON.parse(fs.readFileSync(path.join(process.env.HOME ?? "~", ".claude.json"), "utf8")),
    );
    if (parsed) return parsed;
  } catch {
    /* fall through to the refusal */
  }
  return {
    reason:
      "no way to reach thinkube-control — set thinkubeTandem.controlUrl and controlToken, or connect the thinkube-control MCP server",
  };
}

interface CatalogTemplate {
  name: string;
  description?: string;
  url: string;
  deployment_type?: string;
}

/** The credential-bearing clone URL, following the pod's own convention
 *  (read from a sibling app's origin — never invented). */
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
    /* fall through */
  }
  return `https://git.thinkube.com/thinkube-deployments/${appName}.git`;
}

async function newAppFromTemplate(args: {
  product: string;
  appsRoot: string;
  /** Attach the new repository to this project space's context scope. */
  attachScope?: (repoId: string) => void;
  refresh: () => void;
  activate: (cardId: string) => Promise<void>;
}): Promise<void> {
  const vsc = vs();
  const auth = controlAuth();
  if ("reason" in auth) {
    void vsc.window.showWarningMessage(`Tandem — ${auth.reason}`);
    return;
  }
  const get = async (p: string): Promise<unknown> => {
    const res = await fetch(`${auth.base}${p}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) throw new Error(`${p} → ${res.status}`);
    return res.json();
  };
  let catalog: CatalogTemplate[];
  try {
    const raw = (await get("/api/v1/templates/list")) as { templates?: CatalogTemplate[] };
    catalog = (raw.templates ?? []).filter((t) => (t.deployment_type ?? "app") === "app");
  } catch (e) {
    void vsc.window.showWarningMessage(`Tandem — the template catalog is unreachable: ${String(e)}`);
    return;
  }
  const tpl = await vsc.window.showQuickPick(
    catalog.map((t) => ({ label: t.name, detail: t.description, description: t.url, t })),
    { title: "Which starting point? (the platform's template catalog)" },
  );
  if (!tpl) return;
  const appName = await vsc.window.showInputBox({
    title: "Name the new application",
    prompt: "Lowercase letters, digits and dashes — it becomes the repository name.",
    validateInput: (v) => (/^[a-z][a-z0-9-]{1,38}$/.test(v) ? undefined : "lowercase-with-dashes"),
  });
  if (!appName) return;
  // A leftover folder makes the platform's git step push the wrong branch
  // (the todo/master incident) — refuse up front with the cure named.
  const dest = path.join(args.appsRoot, appName);
  if (fs.existsSync(dest)) {
    void vsc.window.showWarningMessage(
      `Tandem — ${dest} already exists. Delete that folder or pick another name; the platform will not deploy over it.`,
    );
    return;
  }
  const description =
    (await vsc.window.showInputBox({ title: "One line: what is this application?" })) ?? "";
  let deploymentId: string;
  try {
    const res = await fetch(`${auth.base}/api/v1/templates/deploy-async`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        template_url: tpl.t.url,
        template_name: appName,
        variables: { project_description: description },
        execution_mode: "background",
      }),
    });
    if (!res.ok) throw new Error(`deploy → ${res.status} ${await res.text()}`);
    deploymentId = ((await res.json()) as { deployment_id: string }).deployment_id;
  } catch (e) {
    void vsc.window.showErrorMessage(`Tandem — instantiation refused: ${String(e).slice(0, 300)}`);
    return;
  }
  const outcome = await vsc.window.withProgress(
    {
      location: vsc.ProgressLocation.Notification,
      title: `Tandem — creating "${appName}" from ${tpl.label}…`,
    },
    async (progress) => {
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const st = (await get(`/api/v1/templates/deployments/${deploymentId}`)) as {
            status: string;
            output?: string;
          };
          progress.report({ message: st.status });
          if (st.status === "completed") return { ok: true as const };
          if (["failed", "cancelled", "error"].includes(st.status))
            return { ok: false as const, detail: (st.output ?? st.status).slice(-600) };
        } catch {
          /* transient — keep polling */
        }
      }
      return { ok: false as const, detail: "timed out after 15 minutes — check thinkube-control" };
    },
  );
  if (!outcome.ok) {
    void vsc.window.showErrorMessage(`Tandem — the instantiation did not finish: ${outcome.detail}`);
    return;
  }
  if (!fs.existsSync(dest))
    await new Promise<void>((resolve, reject) =>
      execFile("git", ["clone", cloneUrlFor(args.appsRoot, appName), dest], (err) =>
        err ? reject(err) : resolve(),
      ),
    ).catch((e) => {
      void vsc.window.showWarningMessage(
        `Tandem — the repository exists on the forge but cloning failed: ${String(e).slice(0, 200)}`,
      );
    });
  if (!fs.existsSync(dest)) return;
  const minted = mintCard(dest, { label: appName, product: args.product }, configuredStoreRoot());
  if (minted.ok) {
    if (!(vsc.workspace.workspaceFolders ?? []).some((f) => f.uri.fsPath === dest))
      vsc.workspace.updateWorkspaceFolders(vsc.workspace.workspaceFolders?.length ?? 0, 0, {
        uri: vsc.Uri.file(dest),
      });
    args.attachScope?.(minted.card.id);
    args.refresh();
    await args.activate(minted.card.id);
  } else {
    void vsc.window.showErrorMessage(`Tandem: ${minted.reason}`);
  }
}

/** The + gesture wrapper: wires the active project space's scope so the
 *  newborn repository is checked for reading automatically. */
export async function newAppGesture(args: {
  product: string;
  storeRoot: string;
  ownerKey?: string;
  activeSlug?: string;
  refresh: () => void;
  activate: (cardId: string) => Promise<void>;
}): Promise<void> {
  await newAppFromTemplate({
    product: args.product,
    appsRoot: path.join(process.env.HOME ?? "~", "apps"),
    ...(args.ownerKey?.startsWith("wp:") && args.activeSlug
      ? {
          attachScope: (repoId: string) => {
            const dirs = thinkingSpaceDirs(
              args.storeRoot,
              args.ownerKey!.slice(3),
              args.activeSlug!,
              "_",
              "project",
            );
            writeContextScope(dirs.foldDir, [...readContextScope(dirs.foldDir), repoId]);
          },
        }
      : {}),
    refresh: args.refresh,
    activate: args.activate,
  });
}
