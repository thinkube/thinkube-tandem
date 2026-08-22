/**
 * Who is thinking. The author keys every record path and every minted id,
 * so it must differ between people. A value the platform provisions
 * identically on every installation separates nobody: it looks like
 * collision protection while guaranteeing the collision.
 *
 * The identity is the person's GitHub account, which the platform already
 * carries as GITHUB_USERNAME. Where the process does not hold it, the
 * GitHub CLI's own recorded login is the same account from the same
 * source. Nothing else is accepted — a machine or repository setting is
 * not a person.
 */

import { readFileSync } from "node:fs";

interface AuthorDeps {
  env: Record<string, string | undefined>;
  /** Reads a file, or undefined when it is not there. */
  readFile: (path: string) => string | undefined;
  home: string;
}

/** The variable the platform sets, named here so a failure can name it. */
const AUTHOR_VARIABLE = "GITHUB_USERNAME";

/** What to say when no identity can be found — it names the fix. */
export const AUTHOR_MISSING =
  `I do not know who you are, so I will not write records under a name ` +
  `shared with everyone else. Set ${AUTHOR_VARIABLE} to your GitHub ` +
  `account, or sign in with the GitHub CLI (gh auth login).`;

const clean = (s: string): string =>
  s
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

/** The GitHub login the CLI recorded when this person signed in. */
function fromGitHubCli(deps: AuthorDeps): string {
  const hosts = deps.readFile(`${deps.home}/.config/gh/hosts.yml`) ?? "";
  return clean(/^\s+user:\s*(\S+)\s*$/m.exec(hosts)?.[1] ?? "");
}

/**
 * The author for this installation, or undefined when the person cannot
 * be identified. Never invents one: an anonymous default is the same
 * constant on every installation, which is the defect it would hide.
 */
function resolveAuthor(deps: AuthorDeps): string | undefined {
  return clean(deps.env[AUTHOR_VARIABLE] ?? "") || fromGitHubCli(deps) || undefined;
}

/** The author of this installation, read from the running process. */
export function currentAuthor(): string | undefined {
  return resolveAuthor({
    env: process.env,
    home: process.env.HOME ?? "",
    readFile: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
  });
}
