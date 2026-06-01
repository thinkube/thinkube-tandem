/**
 * AuthService — resolves a GitHub token for the extension's use.
 *
 * Resolution order (each step is best-effort; first non-empty wins):
 *   1. `GITHUB_TOKEN` environment variable — for CI / scripted runs.
 *   2. `gh auth token` — picks up the user's existing GitHub CLI login. Cheap
 *      and universally available on dev machines that already use `gh`.
 *   3. VS Code SecretStorage under `thinkube.github.token` — interactive
 *      fallback when neither env nor `gh` is set. The user is prompted via
 *      `promptAndStore()` (or `getToken({prompt: true})`).
 *
 * The token is cached in-memory per AuthService instance. Call `invalidate()`
 * after a 401/403 so the next lookup re-resolves through the chain (the user
 * may have just refreshed `gh auth login`, for example).
 *
 * Scopes assumed: `repo` + `project` for write paths. We don't validate
 * scopes here — surfacing the failure at first mutation is acceptable for
 * chunk 3 (the smoke command is read-only).
 */
import * as vscode from "vscode";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const SECRET_KEY = "thinkube.github.token";

export class AuthService {
  private cachedToken: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Resolve a token. Returns undefined if every step fails and `prompt` is
   * false. With `prompt: true`, falls back to an interactive input box and
   * stores the result in SecretStorage.
   */
  async getToken(opts: { prompt?: boolean } = {}): Promise<string | undefined> {
    if (this.cachedToken) return this.cachedToken;

    const fromEnv = process.env.GITHUB_TOKEN;
    if (fromEnv && fromEnv.trim()) {
      this.cachedToken = fromEnv.trim();
      return this.cachedToken;
    }

    const fromGh = await this.tryGhAuthToken();
    if (fromGh) {
      this.cachedToken = fromGh;
      return this.cachedToken;
    }

    const fromSecret = await this.context.secrets.get(SECRET_KEY);
    if (fromSecret) {
      this.cachedToken = fromSecret;
      return this.cachedToken;
    }

    if (opts.prompt) {
      const stored = await this.promptAndStore();
      return stored;
    }

    return undefined;
  }

  /** Prompt the user for a token and persist it in SecretStorage. */
  async promptAndStore(): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
      title: "GitHub token for Thinkube Kanban",
      prompt:
        "Paste a fine-grained or classic PAT with `repo` and `project` scopes",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "ghp_… or github_pat_…",
    });
    if (!input) return undefined;
    const trimmed = input.trim();
    await this.context.secrets.store(SECRET_KEY, trimmed);
    this.cachedToken = trimmed;
    return trimmed;
  }

  /** Drop both the in-memory cache and the SecretStorage entry. */
  async clear(): Promise<void> {
    this.cachedToken = undefined;
    await this.context.secrets.delete(SECRET_KEY);
  }

  /** Drop just the in-memory cache; next getToken() re-resolves. */
  invalidate(): void {
    this.cachedToken = undefined;
  }

  private async tryGhAuthToken(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync("gh auth token", { timeout: 5000 });
      const token = stdout.trim();
      return token || undefined;
    } catch {
      // gh missing, not logged in, or PATH issue — silent fallback.
      return undefined;
    }
  }
}
