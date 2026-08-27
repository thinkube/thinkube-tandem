/**
 * The forge adapter: acceptance-as-merge executes on whichever forge hosts
 * the project, resolved from the remote URL. The gates and records never
 * know which forge ran; both implementations satisfy one interface.
 */
import { execFile } from "node:child_process";

export interface Forge {
  kind: "github" | "gitea";
  /** Open the delivery as a pull request; resolves to its URL. */
  openDelivery(args: {
    branch: string;
    title: string;
    body: string;
  }): Promise<string>;
  /** Execute the human's acceptance: merge the delivery. */
  merge(ref: string): Promise<void>;
}

interface RemoteTarget {
  kind: "github" | "gitea";
  host: string;
  owner: string;
  repo: string;
}

/** Resolve which forge a remote URL names. Unknown hosts are Gitea: the
 *  self-hosted platform is the default world, github.com the special case. */
function detectForge(remoteUrl: string): RemoteTarget | undefined {
  const m =
    /^(?:git@|https?:\/\/)([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
      remoteUrl.trim(),
    );
  if (!m) return undefined;
  const [, host, owner, repo] = m;
  return {
    kind: host === "github.com" ? "github" : "gitea",
    host,
    owner,
    repo,
  };
}

export type Exec = (cmd: string, args: string[]) => Promise<string>;

const defaultExec: Exec = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8" }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    );
  });

function githubForge(target: RemoteTarget, exec: Exec = defaultExec): Forge {
  const repo = `${target.owner}/${target.repo}`;
  return {
    kind: "github",
    openDelivery: ({ branch, title, body }) =>
      exec("gh", [
        "pr",
        "create",
        "--repo",
        repo,
        "--head",
        branch,
        "--title",
        title,
        "--body",
        body,
      ]),
    merge: async (ref) => {
      await exec("gh", ["pr", "merge", ref, "--repo", repo, "--merge"]);
    },
  };
}

export type HttpCall = (
  method: string,
  url: string,
  token: string,
  payload?: unknown,
) => Promise<unknown>;

function giteaForge(
  target: RemoteTarget,
  token: string,
  http: HttpCall,
): Forge {
  const api = `https://${target.host}/api/v1/repos/${target.owner}/${target.repo}`;
  return {
    kind: "gitea",
    openDelivery: async ({ branch, title, body }) => {
      const res = (await http("POST", `${api}/pulls`, token, {
        head: branch,
        base: "main",
        title,
        body,
      })) as { html_url?: string; number?: number };
      return res.html_url ?? `${api}/pulls/${res.number}`;
    },
    merge: async (ref) => {
      // The ref arrives as the stored PR URL; Gitea's merge endpoint
      // takes the PR INDEX — extract it, refuse plainly when absent.
      const index = /(\d+)\/?$/.exec(ref)?.[1];
      if (!index) throw new Error(`cannot merge "${ref}" — no pull-request number in the reference`);
      await http("POST", `${api}/pulls/${index}/merge`, token, {
        Do: "merge",
      });
    },
  };
}

/** One entry point: the right forge for a remote, or a stated refusal. */
export function forgeFor(
  remoteUrl: string,
  opts: { giteaToken?: string; exec?: Exec; http?: HttpCall } = {},
): Forge {
  const target = detectForge(remoteUrl);
  if (!target)
    throw new Error(`cannot resolve a forge from remote '${remoteUrl}'`);
  if (target.kind === "github") return githubForge(target, opts.exec);
  if (!opts.giteaToken)
    throw new Error(
      `remote '${remoteUrl}' is a Gitea forge and no token is configured`,
    );
  if (!opts.http)
    throw new Error(`gitea forge requires an http caller`);
  return giteaForge(target, opts.giteaToken, opts.http);
}
