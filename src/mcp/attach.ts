/**
 * Attach to a thinking space that already exists, exactly as the editor
 * attaches to it.
 *
 * "Exactly" is the whole requirement. A session built with a different
 * store directory writes a parallel space nobody is looking at; one built
 * with a different author folds a different trail; one built with a
 * different storage directory cannot read the approvals the person's
 * clicks minted, so every signed cut looks unapproved. Each of those
 * fails quietly and looks like a bug somewhere else.
 *
 * So the four coordinates are resolved from the same places the editor
 * resolves them — the store's cards, the person's git identity, and the
 * editor's own global storage — and never guessed.
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import { TandemSession } from "../surfaces/session";
import { currentAuthor } from "../core/author";
import { discoverProjects } from "../core/identity";
import type { EnabledProject } from "../core/identity";
import { listThinkingSpaces, nextTepNumber, thinkingSpaceDirs } from "../core/spaces";
import { allCards } from "../core/cards";
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { configureDocsRoots, docsRootsOf } from "../core/docsDuty";
import { factsOf } from "../run/facts";
import { Forge, forgeFor } from "../dispatch/forge";

/** Where the editor keeps approvals and the signing key. A session that
 *  reads anywhere else sees every signed cut as unapproved. */
const EDITOR_STORAGE =
  "/home/thinkube/.local/share/code-server/User/globalStorage/thinkube.thinkube-tandem";

/** The store, from the environment or the same default the editor uses. */
export function storeRootOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.TANDEM_STORE || path.join(env.HOME ?? "~", "thinkube-tandem-store");
}

/** The project a directory belongs to, by its card in the store. */
function projectAt(repoRoot: string, storeRoot: string): EnabledProject | undefined {
  return discoverProjects(repoRoot, storeRoot, 0)[0] ?? discoverProjects(repoRoot, storeRoot, 2)[0];
}

/** The repository's own forge, resolved as the run without a window does:
 *  from the remote, with the credential it may carry stripped from the URL
 *  but kept as the token. */
async function forgeOf(repoRoot: string): Promise<Forge | undefined> {
  const raw = await new Promise<string>((resolve) =>
    execFile("git", ["-C", repoRoot, "remote", "get-url", "origin"], (err, out) =>
      resolve(err ? "" : out.trim()),
    ),
  );
  if (!raw) return undefined;
  const creds = /^https?:\/\/([^/@:]+):([^/@]+)@/.exec(raw);
  const remote = creds ? raw.replace(`${creds[1]}:${creds[2]}@`, "") : raw;
  const token = process.env.TANDEM_GITEA_TOKEN || creds?.[2];
  return forgeFor(remote, {
    ...(token ? { giteaToken: token } : {}),
    http: async (method, url, tok, payload) => {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `token ${tok}`, "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
      return (await res.json()) as unknown;
    },
  });
}

export interface AttachArgs {
  /** The repository (or subtree) whose card names the project. */
  repo: string;
  /** The thinking space's directory name, as the editor slugged it. */
  space: string;
  storeRoot?: string;
  storageDir?: string;
  onChanged?: (message?: string) => void;
}

export type Attached =
  | { ok: true; session: TandemSession; project: EnabledProject; storeDir: string }
  | { ok: false; reason: string };

/** Build the session the editor would build for this space. */
export async function attach(args: AttachArgs): Promise<Attached> {
  const storeRoot = args.storeRoot ?? storeRootOf();
  const author = currentAuthor();
  if (!author)
    return { ok: false, reason: "no git identity — set user.email so the record has an author" };
  const project = projectAt(path.resolve(args.repo), storeRoot);
  if (!project)
    return {
      ok: false,
      reason: `${args.repo} is not an enabled project — no card in ${storeRoot}/cards names it`,
    };
  const dirs = thinkingSpaceDirs(storeRoot, project.card.id, args.space, author);
  configureDocsRoots(
    docsRootsOf(project.gitRoot, (() => { const d = thinkubeDeclaration(project.gitRoot); return d && "declared" in d ? d.declared.docsRoot : undefined; })()),
  );
  const told = factsOf(project.gitRoot);
  const forge = await forgeOf(project.gitRoot);
  const session = new TandemSession({
    round: { model: "opus", volumeModel: "sonnet", repoRoot: project.anchorDir },
    storeDir: dirs.storeDir,
    projectDir: dirs.foldDir,
    storageDir: args.storageDir ?? EDITOR_STORAGE,
    now: () => new Date().toISOString(),
    author,
    ...(forge ? { forge } : {}),
    scope: {
      gitRoot: project.gitRoot,
      prefix: project.prefix,
      projectId: project.card.id,
      label: project.card.product
        ? `${project.card.product} / ${project.card.label}`
        : project.card.label,
    },
    // Candidates only — what this repository last proved about itself. The
    // door runs each again and refuses by name if none answers, so nothing
    // a person never verified reaches a judgement.
    ...(told ? { told: { ...(told.suite ? { suite: told.suite } : {}), ...(told.build ? { build: told.build } : {}), ...(told.runOne ? { runOne: told.runOne } : {}), ...(told.provision ? { provision: told.provision } : {}) } } : {}),
    ...(told?.prepare ? { prepareCommand: told.prepare } : {}),
    workerModel: { workerModel: "sonnet" },
    maxConcurrent: 4,
    docsGateMode: "blocking",
    nextTepNumber: () => nextTepNumber(storeRoot, project.card.id, author),
    ...(args.onChanged ? { onChanged: args.onChanged } : {}),
  });
  session.load();
  return { ok: true, session, project, storeDir: dirs.storeDir };
}

/**
 * Every enabled project the store knows, with the thinking spaces filed
 * under each. The store is the register — a project is enabled because a
 * card names it, not because a folder happens to be open somewhere.
 */
export function knownSpaces(storeRoot = storeRootOf()): {
  project: string;
  label: string;
  at?: string;
  spaces: string[];
}[] {
  return allCards(storeRoot).map((c) => ({
    project: c.id,
    label: c.product ? `${c.product} / ${c.label}` : c.label,
    ...(c.at ? { at: c.at } : {}),
    spaces: listThinkingSpaces(storeRoot, c.id).map((s) => s.slug),
  }));
}
