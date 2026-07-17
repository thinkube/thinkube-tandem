# Chat unlock spike — native Claude chat in the Thinkube code-server build

**Date:** 2026-07-17 · **Status:** patches applied (live + distro), pending window-reload field test

## Question

Can the native chat panel in the Thinkube code-server build (1.128) work **without a GitHub
account**, with **Claude via the local Claude Code login** (subscription, no API tokens)?

## Finding: yes — it is a settings flip plus an optional manifest touch

The build bundles `GitHub.copilot-chat` v0.56 as a builtin
(`/usr/lib/code-server/lib/vscode/extensions/copilot/`). Reverse-engineering the compiled
workbench and extension found the full gate chain:

1. **A complete "Claude Agent" chat session type already ships** (`chatSessions` type
   `claude-code`, "Powered by the same agent as Claude Code"). Its `when` clause keys on
   `config.github.copilot.chat.claudeAgent.enabled`, which **defaults to `true`** — no work
   needed there.
2. **The provider is the Claude Agent SDK spawning the local `claude` CLI**
   (SDK 0.2.112 embedded; `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, `settingSources:
   ["user","project","local"]`, preset system prompt `claude_code`). Auth is whatever the
   local CLI login is — the Claude Code subscription. **No API key path is involved.**
   The `claude` CLI is present in the image (`~/.local/bin/claude`).
3. **The only hard wall is GitHub sign-in.** The session type declares
   `requiresCopilotSignIn: true`, and core's per-session gate blocks any session type with
   that flag while the entitlement is "unknown" (signed out) — *unless* the entitlement
   service's `anonymous` flag is true. `anonymous` is computed as: setting
   **`chat.allowAnonymousAccess` = true** AND signed out AND chat not hidden/disabled.
   With `anonymous` true the gate falls through to "does the session type have models?",
   which the claude-code provider satisfies by itself: it registers **unconditionally** at
   service construction and lists models from the local CLI, each stamped
   `targetChatSessionType: "claude-code"`.
4. **The manifest's `"when": "false"` on the `claude-code` model vendor is cosmetic-only.**
   Core registers all vendors regardless of `when`; the clause only filters the
   provider-management UI (`getVendors()`). Dropping it makes "Claude Code" visible in the
   model picker management list; leaving it does not block the session.

## Patches applied

| Where | What | State |
|---|---|---|
| `~/.local/share/code-server/User/settings.json` | `"chat.allowAnonymousAccess": true` | applied (live test) |
| `thinkube-control/13_configure_code_server.yaml` | same setting seeded in the ansible `combine` merge | committed |
| `harbor-images/base-images/code-server-dev.Containerfile.j2` | jq step dropping `when:"false"` from the claude-code vendor in the builtin's manifest (guarded, fails build if the shape changes) | committed |
| live `/usr/lib/code-server/lib/vscode/extensions/copilot/package.json` | same jq patch via sudo | applied (live test) |

## Field test (requires window reload)

Reload the window → open the Chat panel → the session/agent picker should offer **"Claude"**
(welcome: "Claude Agent"). First message should stream through the local CLI — verify with
`claude` usage and no GitHub sign-in prompt. If the panel still demands sign-in, the
fallback recorded in the plan applies (owned sidebar chat view), and `@tandem` (Phase C)
works in either surface.

## Risks / notes

- v0.56 is a moving target: upstream merges copilot-chat into VS Code core through 2026.
  The Containerfile guard `jq -e` fails the image build loudly if the manifest shape
  changes, so drift is caught at build time, not in the field.
- `chat.allowAnonymousAccess` does **not** make usage anonymous — Claude auth still runs
  through the local CLI login. It only skips the GitHub/Copilot identity ceremony.
- `github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions` stays default-off;
  the agent asks before tool use like terminal Claude Code does.
