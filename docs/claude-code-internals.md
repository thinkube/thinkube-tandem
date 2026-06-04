# claude-code internals: session storage, restore, and the session-link bridge

**Status:** living reference — re-verify on claude-code updates
**Verified against:** `anthropic.claude-code` **2.1.162** (code-server / Linux), 2026-06-04
**Related code:** `src/services/sessionLinks.ts`, `src/services/SessionLinkService.ts`, `wrapper/claude-cwd-wrapper.sh`

> ⚠️ Everything in this document describes **undocumented, reverse-engineered
> behaviour** of the claude-code VS Code extension and the Claude CLI. None of
> it is API. Any claude-code release can invalidate any finding below. The
> design constraint that follows from this: every dependency on these findings
> must **fail soft** — if claude-code changes, the extension must degrade to
> "feature stops working", never to data loss or broken launches.
> §6 explains what breaks how, and §7 is the re-verification playbook.

## 1. The problem this solves

`Open Claude Code Here` roots a session in the _clicked_ folder by patching
the spawn cwd through the process wrapper (see `CLAUDE.md` → "Claude launcher").
That worked for launching — but the sessions it created were **second-class**
to claude-code:

- they never appeared in the native **Session History** picker, and
- after a **window reload** their tabs respawned as _empty new conversations_ —
  the original conversation looked lost.

The transcripts were never gone (they live on disk, see F1), but they were
unreachable from the UI. The session-link bridge (§5) makes them first-class
again.

## 2. How sessions are stored (CLI side)

**F1 — transcript layout.** Every conversation is one JSONL file:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
```

- `<encoded-cwd>` is derived from the CLI process's **cwd at session
  creation**: `realpath(cwd).normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-")`
  (e.g. `/home/thinkube/thinkube-platform/core/thinkube` →
  `-home-thinkube-thinkube-platform-core-thinkube`). If `realpath` fails, the
  raw path is encoded.
- The root honours `CLAUDE_CONFIG_DIR` (defaults to `~/.claude`).
- Sidecar data lives next to the transcript: a `<uuid>/` directory
  (`subagents/`, `tool-results/`, `workflows/`), and extra JSONL records
  _inside_ the transcript (`ai-title`, `pr-link`, …).
- The transcript records the original cwd as a `"cwd"` field in its entries.
- The file is created **on the first prompt**, not at panel open.

**F2 — resume is keyed off cwd.** `claude --resume <uuid>` looks for the
session under the _current directory's_ encoded project dir. Resuming from
the wrong cwd fails with `No conversation found with session ID …`. This is
why the wrapper's RESUME branch reads `"cwd"` out of the JSONL and `cd`s
there before exec (`wrapper/claude-cwd-wrapper.sh`, RESUME section).

_Evidence:_ bundle functions equivalent to
`projectDir(cwd) = join(configDir, "projects", encode(cwd))` with
`encode = s => s.replace(/[^a-zA-Z0-9]/g, "-")`; empirical directory names
match byte-for-byte (parity check in the §5 smoke test).

## 3. How the extension spawns and scopes sessions

**F3 — panel spawn shape.** A Claude panel's CLI backend is spawned with
cwd = `realpathSync(workspaceFolders[0] ?? homedir()).normalize("NFC")` and
the _other_ workspace roots passed as `--add-dir`. Observed argv (wrapper
log capture):

```
--output-format stream-json --verbose --input-format stream-json
--max-thinking-tokens 31999 --permission-prompt-tool stdio
--setting-sources=user,project,local --permission-mode auto
--add-dir <root2> --add-dir <root3> --debug --debug-to-stderr
--enable-auth-status --no-chrome --replay-user-messages
```

In this workspace (`thinkube.code-workspace`: Apps, User Templates,
Platform) that default cwd is **`/home/thinkube/apps`** — the behaviour the
cwd-patching wrapper exists to override.

**F4 — the Session History picker is single-directory.** The picker (and
everything that resolves a session id) reads **only**
`~/.claude/projects/<encode(workspaceFolders[0])>/`. Sessions filed under
any other encoded dir — i.e. every session our launcher creates — are
invisible to it.

**F5 — reload restore re-resolves the session through the picker dir.** The
webview serializer for `claudeVSCodePanel` restores a panel like this
(bundle, abridged):

```js
async deserializeWebviewPanel(F, v) {
  let R = typeof v?.isFullEditor === "boolean" ? v.isFullEditor : …;
  U.setupPanel(F, void 0, void 0, R)   // ← no session id passed here
}
```

The extension layer passes no session id — but the **webview's own persisted
state re-supplies it** once the panel loads, and the resulting resume is
subject to the picker-dir validation (F6). Two observed outcomes:

- Transcript **not visible** in the picker dir → silent fallback: the
  restored panel spawns a **brand-new conversation** (wrapper logs:
  post-reload spawn carries no `--resume`/`--session-id`/`--continue`).
  The old transcript is untouched — orphaned, not deleted.
- Transcript **visible** (e.g. symlinked, F8) → the extension spawns the CLI
  **with `--resume <uuid>`** (observed mid-argv, i.e. added by the extension,
  not by our wrapper) and the tab comes back with the conversation loaded.

Consequence: the symlink bridge doesn't just fix the picker — **it makes
launcher-created sessions survive window reloads.**

**F6 — `editor.open` takes a session id as first argument.** Both
`claude-vscode.editor.open` and `claude-vscode.primaryEditor.open` accept
`(sessionId?, prompt?, viewColumn?)`:

```js
createPanel(z, V, B) {            // z = session id
  if (z) { let O = this.sessionPanels.get(z); if (O) { O.reveal(); … } }
  …
```

Our `LauncherService.openHere` calls this command with `undefined` as the
first argument. **Caveat:** the id is validated against the picker directory
(F4) first — an id whose transcript isn't visible there **silently falls
back to a new session** (verified: the spawn carries no resume flags).

**F7 — URI handler.** `<scheme>://anthropic.claude-code/open?session=<uuid>&prompt=<p>`
routes to `primaryEditor.open(session, prompt)`. The scheme is the product's
`urlProtocol` — **`code-oss`** on this code-server install, `vscode` on
desktop VS Code. Triggerable via Command Palette → _Open URL_. Subject to
the same F6 validation.

**F8 — symlinks in the picker dir are honoured end-to-end.** A symlink
`pickerDir/<uuid>.jsonl → otherProjectDir/<uuid>.jsonl` makes the session
appear in the picker with full history, and resuming it works: the extension
renders from the linked file and spawns `--resume <uuid>`; the wrapper
redirects cwd from the JSONL's `"cwd"`; the CLI then appends to the original
file (same inode, no divergence). Verified live on session `2bb53b96…`.

## 4. Experiments that led here

| #   | Experiment                                                                                       | Result                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Force wrapper logging (`CLAUDE_CWD_PROXY_LOG`), reload window                                    | Restored panel spawns **fresh** — no resume flags (F5)                                                                                                                                              |
| E2  | One-shot argv injection: wrapper prepends `--resume <uuid>` from a `.target-resume` handoff file | CLI resumed correctly (transcript appended, full context on questioning) but the **webview rendered an empty chat** — the extension didn't know its CLI had resumed. Functional, bad UX. Abandoned. |
| E3  | Resume-by-id via URI/command while the transcript was outside the picker dir                     | Silent fallback to a new session (F6 validation)                                                                                                                                                    |
| E4  | **Symlink the transcript into the picker dir**, then resume via the native picker                | Full native UX: listed, history rendered, resumed in the correct cwd. **Adopted.**                                                                                                                  |
| E5  | Reload the window while the open session's transcript is symlinked into the picker dir           | Tab restored **with the conversation loaded** — the post-reload spawn carries `--resume <uuid>` added by the extension itself. The bridge fixes reload survival too (F5).                           |

E2 is worth remembering: argv injection through the wrapper _does_ work at
the CLI level and needs no claude-code cooperation. It's the fallback design
if a future claude-code release breaks the symlink approach but keeps the
wrapper protocol.

## 5. The implementation: session-link bridge

Two modules, deliberately split:

- **`src/services/sessionLinks.ts`** — pure fs logic, no `vscode` import, so
  it can be smoke-tested with plain node against a temp dir
  (`require("./dist/services/sessionLinks.js")`). Owns the encoding
  (mirroring F1), the sweep (symlink every `<uuid>.jsonl` from target
  project dirs into the picker dir; skip per-session subdirs and symlinks so
  links never chain; `EEXIST` = already mirrored; Windows `EPERM` falls back
  to hardlinks — same volume by construction), and pruning of dangling
  symlinks.
- **`src/services/SessionLinkService.ts`** — vscode lifecycle. Persists every
  `Open Here` target folder in `globalState`
  (`thinkube.launcher.sessionLinkTargets`), and sweeps:
  - on activation,
  - on `onDidChangeWorkspaceFolders` (the picker dir moves with
    `workspaceFolders[0]`),
  - after each launch, polling every 20 s for 10 min — because the
    transcript only exists after the first prompt (F1).

`LauncherService.openHere()` calls `sessionLinks.noteLaunch(folder)` after a
successful launch. Registering a folder retroactively links **all** of its
existing sessions on the next sweep — one `Open Here` on an old folder
recovers its whole history into the picker.

The wrapper needed **no changes**: its pre-existing RESUME branch (read
`"cwd"` from the JSONL, `cd` there) completes the loop when the picker
resumes a linked session.

The board navigator (`thinkubeBoards`) doubles as the session manager: each
repo row carries inline **New Claude Session Here** (delegates to the
launcher) and **Resume Claude Session…** actions. Resume lists the repo's
sessions via `listSessionsForFolder()` — membership is decided by the
`"cwd"` recorded inside each transcript (the encoded dir name is lossy), so
sessions rooted in subfolders of the repo count — then calls
`ensureVisible()` and `claude-vscode.editor.open(<uuid>)` (F6) for a native,
history-rendered reopen.

Known trade-offs (deliberate for v1):

- **"Remove" resurrection** — deleting a session in the picker UI only
  unlinks the symlink; the next sweep re-creates it. The original transcript
  is the source of truth and the extension never deletes it.
- **Reload survival depends on the link existing at reload time.** A linked
  session's tab survives a window reload with its conversation loaded (F5,
  second outcome; verified E5). A session whose transcript isn't linked yet —
  first prompt just sent, sweep not yet run, window reloaded immediately —
  restores as a fresh conversation (F5 fallback). The post-launch poll
  window keeps that gap to ≤20 s, and the session stays recoverable via the
  picker once swept.

## 6. Failure-mode analysis

What happens if claude-code changes…

| If this changes                                                 | Effect                                                                                                                     | Severity                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Path encoding or projects layout (F1)                           | Sweep links into / from wrong dirs → sessions stop appearing in the picker. Launch/resume of _native_ sessions unaffected. | Graceful — same UX as before the feature |
| Picker scoping (F4) — e.g. becomes multi-root-aware             | Feature becomes redundant; stale symlinks remain but are valid files                                                       | Graceful — and we can delete the feature |
| Webview state stops re-supplying the session id on restore (F5) | Linked sessions stop surviving reloads; still recoverable via the picker                                                   | Graceful                                 |
| `editor.open` signature (F6)                                    | `openHere` already passes `undefined` — only a future resume-by-id caller would break                                      | Contained                                |
| Wrapper protocol (`claudeProcessWrapper`)                       | The whole launcher breaks, not just this feature — separate, pre-existing risk                                             | High (pre-existing)                      |
| Transcript format (`"cwd"` field) (F2)                          | Wrapper resume-redirect fails → resume lands in `workspaceFolders[0]` and the CLI reports "No conversation found"          | Visible, recoverable from terminal       |

Nothing in the feature writes into claude-code's files except **adding
symlinks/hardlinks named `<uuid>.jsonl`** to a directory claude-code already
treats as a session list — the riskiest operation is creating a link, and
the original transcripts are never modified or removed.

## 7. Re-verification playbook

After a claude-code update, re-check the findings against the installed
bundle (adjust the version in the path):

```bash
EXT=~/.local/share/code-server/extensions/anthropic.claude-code-*/extension.js

# F1 — encoding still non-alnum→dash?
grep -oE '[a-zA-Z_$][a-zA-Z0-9_$]*\.replace\(/[^)]{2,30}/g?,"-"\)' $EXT | sort -u

# F4/F3 — picker cwd still workspaceFolders[0]?
grep -oE 'setupPanel\([^)]*\)\{.{0,200}' $EXT | head -c 400

# F5 — serializer still dropping the session id?
grep -oE '.{50}deserializeWebviewPanel.{300}' $EXT

# F6 — editor.open still session-id-first?
grep -oE 'createPanel\([^)]*\)\{.{0,200}' $EXT | head -c 400

# F7 — URI handler still /open?session=…?
grep -oE 'handleUri\([^)]*\)\{.{0,400}' $EXT
```

Live behaviour can be audited any time with the wrapper's built-in logging:
set `CLAUDE_CWD_PROXY_LOG=1` in the extension-host environment (or
temporarily flip the `:-0` default to `:-1` in the _installed_ wrapper —
it's re-exec'd on every spawn, no reload needed) and read
`<globalStorage>/thinkube.thinkube-ai-integration/logs/wrapper-*.log`: every
spawn's tag (fresh / RESUME / probe), argv, initial cwd, and the cwd
decision are recorded.

The encoding parity assertion also lives in the node smoke test used during
development — if `encodeProjectDir()` ever diverges from the directory names
claude-code actually creates, that's the first thing to check.
