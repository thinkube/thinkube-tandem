/**
 * Prompt-template loading (context tranche, 2026-07-14) — PROSE as doctrine, contracts as code.
 *
 * The behavioural prose of the orchestrator's prompts (the worker preamble, the audit's
 * needs-reframe rules, the intent-check instructions) is editable DOCTRINE that must be
 * tweakable without cutting an extension release — yesterday's post-mortem: every prompt
 * tweak cost a full deploy. The machine-parsed OUTPUT-FORMAT stanzas (the JSON reply
 * contracts the parsers depend on) are NOT loaded from here: they stay hardcoded in the
 * builder functions and are appended in code, so an edited template can never break a parser.
 *
 * Resolution order for a template `<name>`:
 *   1. the orchestrated repo's own override: `<repoDir>/.tandem/prompts/<name>.md`
 *      (repoDir = the configured canonical repo, else `process.cwd()` — which also serves
 *      the kanban MCP server process, whose cwd is the session repo);
 *   2. an explicitly configured template dir — the `thinkube.orchestrator.promptTemplateDir`
 *      setting (threaded via {@link configurePromptTemplates}) or the
 *      `THINKUBE_PROMPT_TEMPLATE_DIR` env var;
 *   3. the installed tandem-methodology plugin's `templates/` dir, located the way Claude
 *      Code itself locates the marketplace: `~/.claude/plugins/known_marketplaces.json` →
 *      each marketplace's `installLocation` → `plugins/tandem-methodology/templates/`;
 *   4. `undefined` — the caller then uses its BUNDLED in-code fallback, so a missing file
 *      never breaks a run.
 *
 * No caching: templates are tiny, read at most once per worker/audit spawn, and the whole
 * point is that an edit takes effect on the NEXT run without a reload.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Module-level configuration, set once per orchestration run at the extension-host
 *  boundary (settings are not readable from this pure-node module). */
let configured: {
  repoDir?: string;
  templateDir?: string;
  pluginDirs?: string[];
} = {};

/** Thread the per-run resolution roots in: `repoDir` (the orchestrated repo, for the
 *  `.tandem/prompts/` override), `templateDir` (the setting-configured doctrine dir), and
 *  optionally `pluginDirs` (an explicit plugin-template dir list — tests pass `[]` to
 *  make resolution hermetic; production omits it and gets marketplace discovery).
 *  Idempotent; pass `{}` to reset (tests). */
export function configurePromptTemplates(cfg: {
  repoDir?: string;
  templateDir?: string;
  pluginDirs?: string[];
}): void {
  configured = { ...cfg };
}

/** Read a file if it exists and is non-blank; undefined otherwise (never throws). */
function readIfPresent(file: string): string | undefined {
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}

/** The installed tandem-methodology plugin's `templates/` dirs, located via Claude Code's
 *  own marketplace registry (`~/.claude/plugins/known_marketplaces.json` →
 *  `installLocation`). Best-effort: an absent/corrupt registry yields `[]`. */
export function pluginTemplateDirs(homedir: string = os.homedir()): string[] {
  try {
    const raw = fs.readFileSync(
      path.join(homedir, ".claude", "plugins", "known_marketplaces.json"),
      "utf8",
    );
    const reg = JSON.parse(raw) as Record<
      string,
      { installLocation?: unknown } | undefined
    >;
    const dirs: string[] = [];
    for (const entry of Object.values(reg)) {
      const loc = entry?.installLocation;
      if (typeof loc !== "string" || !loc.trim()) continue;
      const dir = path.join(loc, "plugins", "tandem-methodology", "templates");
      try {
        if (fs.statSync(dir).isDirectory()) dirs.push(dir);
      } catch {
        /* this marketplace doesn't carry the plugin — skip */
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Load the editable PROSE of prompt template `<name>` (e.g. `"worker-preamble"` →
 * `worker-preamble.md`), following the resolution order documented on this module.
 * Returns `undefined` when no template resolves — the caller MUST then fall back to its
 * bundled in-code default (a missing file never breaks a run). Trailing whitespace is
 * trimmed; the content is otherwise verbatim.
 */
export function loadTemplate(
  name: string,
  opts?: { repoDir?: string; templateDir?: string },
): string | undefined {
  const file = `${name}.md`;
  // 1. Repo override — the orchestrated repo's own `.tandem/prompts/<name>.md`.
  const repoDir = opts?.repoDir ?? configured.repoDir ?? safeCwd();
  if (repoDir) {
    const hit = readIfPresent(path.join(repoDir, ".tandem", "prompts", file));
    if (hit !== undefined) return hit.trimEnd();
  }
  // 2. Configured doctrine dir (setting / env).
  const tplDir =
    opts?.templateDir ??
    configured.templateDir ??
    process.env.THINKUBE_PROMPT_TEMPLATE_DIR?.trim() ??
    undefined;
  if (tplDir) {
    const hit = readIfPresent(path.join(tplDir, file));
    if (hit !== undefined) return hit.trimEnd();
  }
  // 3. The installed plugin's templates dir (marketplace registry) — or the explicit
  //    override list a test configures ([] ⇒ hermetic: no machine-state lookup).
  for (const dir of configured.pluginDirs ?? pluginTemplateDirs()) {
    const hit = readIfPresent(path.join(dir, file));
    if (hit !== undefined) return hit.trimEnd();
  }
  // 4. Nothing — the caller uses its bundled fallback.
  return undefined;
}

/** `process.cwd()` that survives a deleted cwd (the kanban server's worktree can be
 *  removed under it — the same `uv_cwd` hazard auditorRunner repairs). */
function safeCwd(): string | undefined {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

/**
 * Resolve `<!-- if:FLAG -->…<!-- endif:FLAG -->` conditional sections in a loaded
 * template: the section body is KEPT (markers stripped) when `flags[FLAG]` is true,
 * DROPPED entirely when false/absent. Lets one doctrine file carry prose that only
 * applies when its data is present (e.g. the audit's INTENT FIDELITY rule, which only
 * makes sense when a parent TEP was supplied) without the builder splicing prose.
 * Non-matching / unclosed markers pass through unchanged. Pure.
 */
export function applyConditionals(
  text: string,
  flags: Record<string, boolean>,
): string {
  return text.replace(
    /[ \t]*<!--\s*if:([A-Za-z0-9_-]+)\s*-->\r?\n?([\s\S]*?)[ \t]*<!--\s*endif:\1\s*-->\r?\n?/g,
    (_m, flag: string, body: string) => (flags[flag] ? body : ""),
  );
}
