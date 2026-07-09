/**
 * RTK (Rust Token Killer) command-output compression rewriter (SP-17/2).
 *
 * Pure module — no vscode import, no process.env, no fs, no Date/random reads.
 * `rtkRewrite` result depends ONLY on the command string.
 */

/**
 * The explicit supported-command list: the leading word(s) a single plain command may be
 * rtk-wrapped by. Exported so tests can verify the starting set without hard-coding it.
 */
export const RTK_SUPPORTED: readonly string[] = [
  "git status",
  "git diff",
  "git log",
  "grep",
  "rg",
  "find",
  "ls",
  "cat",
  "wc",
  "du",
];

/**
 * Returns `rtk ${command}` when the TRIMMED command's leading token(s) exactly match an
 * {@link RTK_SUPPORTED} entry AND the line is a single plain command.
 *
 * Returns `undefined` (NO rewrite) for:
 *   - blank / whitespace-only input,
 *   - a command already starting with `rtk ` (idempotent — no double-wrapping),
 *   - a compound/pipeline line (contains any of: `|`, `&&`, `;`, `>`, `<`, `$(` ),
 *   - a command whose trimmed leading word(s) are not on {@link RTK_SUPPORTED}.
 *
 * Pure: result depends ONLY on the command string argument.
 */
export function rtkRewrite(command: string): string | undefined {
  if (!command) return undefined;
  const trimmed = command.trim();
  if (!trimmed) return undefined;

  // Idempotent: already wrapped by rtk — skip.
  if (trimmed.startsWith("rtk ")) return undefined;

  // Compound / pipeline: any shell metacharacter that turns a single command into multiple.
  // Checked against the trimmed form so leading/trailing whitespace doesn't mask them.
  if (
    trimmed.includes("|") ||
    trimmed.includes("&&") ||
    trimmed.includes(";") ||
    trimmed.includes(">") ||
    trimmed.includes("<") ||
    trimmed.includes("$(")
  ) {
    return undefined;
  }

  // Leading-token match: the trimmed command must begin with a supported entry, followed by
  // either end-of-string (bare command) or a space (command with arguments).
  for (const supported of RTK_SUPPORTED) {
    if (trimmed === supported || trimmed.startsWith(supported + " ")) {
      // Return rtk-prefixed using the TRIMMED command (leading/trailing whitespace stripped).
      return `rtk ${trimmed}`;
    }
  }

  return undefined;
}
