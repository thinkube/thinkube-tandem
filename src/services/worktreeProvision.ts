/**
 * worktreeProvision — run a repo's **declared** provisioning recipe inside a
 * freshly-added git worktree (SP-th4wqh).
 *
 * A fresh worktree is a clean checkout: it has the committed source but **none**
 * of the gitignored, locally-built dependencies a verify needs (`node_modules/`,
 * a `.venv/`, a `target/` cache). Before the verification recipe can run green
 * there, the worktree must be **provisioned**.
 *
 * The old approach (`WorktreeService.linkNodeModules`) hardcoded a Node-only
 * `node_modules` symlink — which doesn't generalize and leaked into git (#16).
 * This replaces it with a **language-agnostic runner**: it reads the repo's own
 * provisioning command from `repo-conventions` (the format defined by sibling
 * spec th4wqi — the first ```` ```setup ```` fenced block under `## Worktree
 * setup`) and runs that single command, once, in the worktree, under SP-B's
 * bounded/non-interactive `runBounded`. No declaration → a deliberate no-op
 * (a pure-docs/pure-source repo provisions nothing and makes no Node assumption).
 *
 * This file owns the **contract** the caller (`WorktreeService.create`) and the
 * hermetic AC#1 test agree on: `provisionWorktree(canonicalRepo, worktreePath)`,
 * the pure recipe parser, and the injectable runner type.
 *
 * No vscode here — pure parsing + a thin `runBounded` call so it is unit-testable
 * over a tmp git repo with a marker recipe (`touch .provisioned`).
 */
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { runBounded, DEFAULT_AC_TIMEOUT_MS } from "./orchestratorCore";

/**
 * Path (relative to a repo root) of the `repo-conventions` skill that declares
 * the provisioning recipe. Installed by the methodology bundle into every
 * project's `.claude/` (see INTEGRATION_PLAN §3.2).
 */
export const REPO_CONVENTIONS_RELPATH = path.join(
  ".claude",
  "skills",
  "repo-conventions",
  "SKILL.md",
);

/**
 * One bounded, non-interactive run of a declared command in `cwd`, resolving its
 * exit code + combined output. Injectable so the runner is unit-testable; the
 * default delegates to {@link runBounded} (the real bounded shell run).
 */
export type ProvisionExec = (
  run: string,
  cwd: string,
) => Promise<{ code: number | null; output: string }>;

/** Knobs for {@link provisionWorktree}. All optional — sensible bounded defaults. */
export interface ProvisionOptions {
  /**
   * Override the runner. Hermetic tests pass their own (or a custom `env`/bound);
   * production leaves it unset and gets the {@link runBounded}-backed default.
   */
  exec?: ProvisionExec;
  /** Hard wall-clock bound for the provisioning command (ms). Default {@link DEFAULT_AC_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Base env for the default runner (a real `npm ci` / `pip install` needs a
   * working PATH). Defaults to `process.env`. Ignored when `exec` is supplied.
   */
  env?: NodeJS.ProcessEnv;
}

/** Outcome of a provisioning attempt. `ran: false` ⇒ no recipe was declared (a no-op). */
export interface ProvisionResult {
  /** Whether a declared recipe was found and executed. */
  ran: boolean;
  /** The command that was run (present iff `ran`). */
  command?: string;
  /** The command's exit code (present iff `ran`); 0 = success. */
  code?: number | null;
  /** The command's combined stdout/stderr (present iff `ran`). */
  output?: string;
}

/**
 * Extract the declared provisioning command from a `repo-conventions` SKILL.md.
 *
 * The contract (sibling spec th4wqi): exactly one command lives in the **first**
 * fenced block tagged `setup` inside the `## Worktree setup` section. We scope to
 * that section first (so the example blocks elsewhere can't match) then take its
 * first ```` ```setup ```` block. Returns the block's trimmed body, or undefined
 * when there is no `## Worktree setup` section or no `setup` block in it. Pure.
 */
export function parseProvisionRecipe(
  skillMarkdown: string,
): string | undefined {
  // Isolate the "## Worktree setup" section: from its heading to the next
  // top-level (`## `) heading or end-of-file. A `### ` sub-heading does not end it.
  const headingRe = /^##\s+Worktree setup\s*$/im;
  const headStart = skillMarkdown.search(headingRe);
  if (headStart === -1) return undefined;
  const afterHeading =
    headStart +
    (headingRe.exec(skillMarkdown.slice(headStart))?.[0].length ?? 0);
  const rest = skillMarkdown.slice(afterHeading);
  const nextHeading = rest.search(/^##\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  // First fenced block whose info string is exactly `setup` (``` or ~~~ fences).
  const fenceRe =
    /^[ \t]*(`{3,}|~{3,})[ \t]*setup[ \t]*\r?\n([\s\S]*?)^[ \t]*\1[ \t]*$/m;
  const m = fenceRe.exec(section);
  if (!m) return undefined;
  const command = m[2].replace(/\s+$/, "").trim();
  return command.length > 0 ? command : undefined;
}

/**
 * Read the `repo-conventions` provisioning recipe from a repo root, or undefined
 * when the file is absent/unreadable or declares no `setup` block.
 */
export async function readProvisionRecipe(
  repoRoot: string,
): Promise<string | undefined> {
  let text: string;
  try {
    text = await fs.readFile(
      path.join(repoRoot, REPO_CONVENTIONS_RELPATH),
      "utf8",
    );
  } catch {
    return undefined; // no repo-conventions installed → nothing to provision.
  }
  return parseProvisionRecipe(text);
}

/**
 * Provision a freshly-added worktree by running the repo's **declared** recipe.
 *
 * Reads the provisioning command from `canonicalRepo`'s `repo-conventions` (the
 * committed source of truth), then runs it **once, from `worktreePath`**, under
 * {@link runBounded} (bounded wall-clock, stdin closed, `GIT_TERMINAL_PROMPT=0`,
 * repo-local `node_modules/.bin` on PATH). Language-agnostic: it never assumes
 * Node — the command is whatever the repo declared. When no recipe is declared
 * it does **nothing** and returns `{ ran: false }`.
 *
 * The command is expected to be idempotent and to produce **only gitignored**
 * outputs (the no-leak rule, enforced separately by `provisioningArtifactsIgnored`).
 */
export async function provisionWorktree(
  canonicalRepo: string,
  worktreePath: string,
  opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const command = await readProvisionRecipe(canonicalRepo);
  if (!command) return { ran: false };

  const exec: ProvisionExec =
    opts.exec ??
    ((run, cwd) =>
      runBounded(run, cwd, {
        timeoutMs: opts.timeoutMs ?? DEFAULT_AC_TIMEOUT_MS,
        env: opts.env ?? process.env,
      }));

  const { code, output } = await exec(command, worktreePath);
  return { ran: true, command, code, output };
}
