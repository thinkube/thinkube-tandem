/**
 * Detect the GitHub `owner/repo` of a working directory from its git remote.
 *
 * The extension shouldn't ask the user to type a repo it can read off the
 * `.git` remote. We shell out to `git remote get-url` (preferring `origin`,
 * then `upstream`, then whatever exists) and parse the common URL shapes:
 *
 *   git@github.com:owner/repo.git          (SSH)
 *   ssh://git@github.com/owner/repo.git    (SSH URL)
 *   https://github.com/owner/repo.git      (HTTPS)
 *   https://github.com/owner/repo          (HTTPS, no .git)
 *
 * Returns undefined when the dir isn't a git repo, has no remote, or the
 * remote isn't a github.com URL (we only resolve GitHub today).
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface RepoCoords {
  owner: string;
  name: string;
}

/** Canonical GitHub commit URL for a SHA on a repo. */
export function buildCommitUrl(coords: RepoCoords, sha: string): string {
  return `https://github.com/${coords.owner}/${coords.name}/commit/${sha}`;
}

/** Parse `owner/repo` out of a single git remote URL, or undefined. */
export function parseGitHubRemote(url: string): RepoCoords | undefined {
  const trimmed = url.trim();
  // Strip an optional trailing ".git" then match the owner/name pair after
  // a github.com host given as either `:` (scp-like SSH) or `/` (URL).
  const m =
    /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(trimmed) ?? undefined;
  if (!m) return undefined;
  const owner = m[1];
  const name = m[2];
  if (!owner || !name) return undefined;
  return { owner, name };
}

/** Resolve the repo coords for a workspace folder from its git remote. */
export async function detectRepoCoords(
  cwd: string,
): Promise<RepoCoords | undefined> {
  for (const remote of ["origin", "upstream"]) {
    const coords = await tryRemote(cwd, remote);
    if (coords) return coords;
  }
  // No origin/upstream — fall back to the first remote that resolves.
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "remote"], {
      timeout: 5000,
    });
    const first = stdout.split(/\r?\n/).find((r) => r.trim());
    if (first) return tryRemote(cwd, first.trim());
  } catch {
    // not a git repo / git missing
  }
  return undefined;
}

async function tryRemote(
  cwd: string,
  remote: string,
): Promise<RepoCoords | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "remote", "get-url", remote],
      { timeout: 5000 },
    );
    return parseGitHubRemote(stdout);
  } catch {
    return undefined;
  }
}
