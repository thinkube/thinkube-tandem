/**
 * `/orchestrate` command (SP-tgs8nz_SL-1): dispatch the next Ready slice of a chosen Spec
 * via `OrchestratorService`. Thin vscode glue — resolves the active board repo, the spec,
 * and the worktree/board config, then calls `dispatchNext` and streams the worker's
 * JSON-log to an output channel. The dispatch logic + parsing are the unit-tested core;
 * the live worker outcome is the human's verdict.
 */
import * as vscode from "vscode";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { WorktreeService } from "../services/WorktreeService";
import { OrchestratorService } from "../services/OrchestratorService";
import * as fs from "node:fs";
import {
  extractDiagnosis,
  buildAttendPrompt,
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
} from "../services/orchestratorCore";
import {
  sessionLogPath,
  answerParkedWorker,
} from "../services/orchestratorSessions";
import type { OwnershipArbiter } from "../services/OwnershipArbiter";
import type { LauncherService } from "../services/LauncherService";
import type { SpecsProvider } from "../views/boards/SpecsProvider";

export interface OrchestrateDeps {
  specsProvider: SpecsProvider;
  /** The arbiter is built async at activation — a getter so we read it when invoked. */
  getArbiter: () => OwnershipArbiter | undefined;
  /** Opens primed sessions for `/attend` (reuses the cwd-wrapper launcher). */
  launcher: LauncherService;
  /** Injectable for tests; defaults to real instances. */
  worktrees?: WorktreeService;
  output?: vscode.OutputChannel;
}

export function registerOrchestrateCommands(
  context: vscode.ExtensionContext,
  deps: OrchestrateDeps,
): void {
  const worktrees = deps.worktrees ?? new WorktreeService();
  const output =
    deps.output ?? vscode.window.createOutputChannel("Thinkube Orchestrator");
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("thinkube.orchestrate", async (specArg?: string, boardCtx?: { root: string; boardDir: string; name: string }) => {
      // Prefer the panel's OWN board (passed by the ▶ button) over the ambient sidebar
      // selection: the button must orchestrate the board it's shown on, not whatever space
      // the sidebar happens to be scoped to (the "No Specs on this board" mismatch).
      let repoPath: string;
      let boardDir: string;
      if (boardCtx) {
        repoPath = boardCtx.root;
        boardDir = boardCtx.boardDir;
      } else {
        const repo = deps.specsProvider.repoEntry;
        if (!repo || !repo.enabled) {
          vscode.window.showInformationMessage(
            "Select an enabled thinking space to orchestrate.",
          );
          return;
        }
        repoPath = repo.path;
        boardDir = repo.boardDir;
      }
      const arbiter = deps.getArbiter();
      if (!arbiter) {
        vscode.window.showWarningMessage(
          "Orchestrator not ready — the ownership arbiter is still activating. Try again in a moment.",
        );
        return;
      }
      try {
        const store = new ThinkubeStore(repoPath, boardDir);
        // listSpecDirs returns bare Spec ids (e.g. "tgxunl") — use them directly. The prior
        // `/SP-.../.exec` ran an SP-prefixed regex over an already-unprefixed id → always
        // undefined → empty, which is why orchestrate reported "No Specs" on every board.
        const specs = await store.listSpecDirs();
        if (specs.length === 0) {
          vscode.window.showInformationMessage("No Specs on this board yet.");
          return;
        }
        // From the ▶ button (control-center graph): a spec id is passed directly — skip the
        // quick-pick and orchestrate exactly the Spec the user clicked.
        let spec: string;
        if (typeof specArg === "string" && specArg.trim()) {
          spec = specArg.replace(/^SP-/, "").trim();
          if (!specs.includes(spec)) {
            vscode.window.showWarningMessage(
              `SP-${spec} is not a Spec on this board.`,
            );
            return;
          }
        } else {
          const specId =
            specs.length === 1
              ? specs[0]
              : await vscode.window.showQuickPick(
                  specs.map((id) => `SP-${id}`),
                  { placeHolder: "Orchestrate which Spec's next Ready slice?" },
                );
          if (!specId) return;
          spec = specId.replace(/^SP-/, "");
        }

        const canonical =
          (await worktrees.canonicalRepo(repoPath)) ?? repoPath;
        const baseDir =
          vscode.workspace
            .getConfiguration("thinkube")
            .get<string>("worktree.baseDir")
            ?.trim() || undefined;
        const boardRoot =
          vscode.workspace
            .getConfiguration("thinkube.boards")
            .get<string>("root")
            ?.trim() || undefined;

        const orchestrator = new OrchestratorService({
          worktrees,
          arbiter,
          store,
          output,
          canonicalRepo: canonical,
          boardRoot,
          baseDir,
          verifyCommand: vscode.workspace
            .getConfiguration("thinkube.orchestrator")
            .get<string>("verifyCommand")
            ?.trim(),
        });
        output.show(true);
        const cap =
          vscode.workspace
            .getConfiguration("thinkube.orchestrator")
            .get<number>("maxConcurrent") ?? 4;
        const r = await orchestrator.dispatchSpec(spec, cap);
        if (!r.ok) {
          vscode.window.showErrorMessage(
            `SP-${spec}: malformed DAG — ${r.reason?.split("\n")[0] ?? "rejected"}`,
          );
        } else if (r.dispatched === 0) {
          vscode.window.showInformationMessage(
            `SP-${spec}: nothing to dispatch — no Ready + deps-satisfied unit.`,
          );
        } else {
          vscode.window.showInformationMessage(
            `SP-${spec}: dispatched ${r.dispatched} unit(s), ${r.advanced.length} slice(s) Done` +
              (r.needsInput.length ? `, ${r.needsInput.length} need input` : "") +
              (r.attention.length ? `, ${r.attention.length} need attention` : "") +
              (r.committed ? " — committed ✓" : ""),
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Orchestrate failed: ${(err as Error).message}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "thinkube.floatOutSession",
      (handle?: string) => floatOutSession(context, handle),
    ),
    vscode.commands.registerCommand(
      "thinkube.attend",
      async (handle?: string) => {
        const repo = deps.specsProvider.repoEntry;
        if (!repo || !repo.enabled) {
          vscode.window.showInformationMessage(
            "Select an enabled thinking space to attend a slice.",
          );
          return;
        }
        try {
          const store = new ThinkubeStore(repo.path, repo.boardDir);
          const h = handle ?? (await pickAttentionSlice(store));
          if (!h) return;
          const m = /^SP-(.+)_SL-(\d+)$/.exec(h);
          if (!m) {
            vscode.window.showErrorMessage(`Bad slice handle "${h}".`);
            return;
          }
          const specId = m[1];
          const rel = store.pathForSlice(specId, Number(m[2]));
          const parsed = await store.getFile(rel);
          const fm = (parsed?.frontmatter ?? {}) as Record<string, unknown>;
          const body = parsed?.body ?? "";

          const canonical =
            (await worktrees.canonicalRepo(repo.path)) ?? repo.path;
          const baseDir =
            vscode.workspace
              .getConfiguration("thinkube")
              .get<string>("worktree.baseDir")
              ?.trim() || undefined;
          const boardRoot =
            vscode.workspace
              .getConfiguration("thinkube.boards")
              .get<string>("root")
              ?.trim() || undefined;
          const worktreePath = await worktrees.create(
            canonical,
            specId,
            baseDir,
            boardRoot,
          );

          // needs-input → prompt for the answer, then continue the parked worker (SL-5).
          if (fm.needs_input) {
            const qm = /##\s*❓\s*Needs input\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(
              body,
            );
            const question = qm?.[1]?.trim() || "(no question recorded)";
            const answer = await vscode.window.showInputBox({
              title: `Answer ${h}`,
              prompt: question,
              ignoreFocusOut: true,
            });
            if (!answer) return;

            // If the worker is still RESIDENT (its streaming session alive in a running
            // orchestration), push the answer in — it continues in place and the running loop
            // verifies + advances it. No board write needed here.
            if (
              typeof fm.worker_unit === "string" &&
              answerParkedWorker(fm.worker_unit, answer)
            ) {
              vscode.window.showInformationMessage(
                `${h}: answer delivered to the live worker — it will continue and verify in the running orchestration.`,
              );
              return;
            }

            // Not resident (e.g. the host reloaded) → fall back to SDK resume by session id.
            if (typeof fm.worker_session !== "string") {
              vscode.window.showWarningMessage(
                `${h}: no live worker and no session to resume — re-run Orchestrate to retry it.`,
              );
              return;
            }
            output.show(true);
            output.appendLine(
              `▸ resuming ${h} (session ${fm.worker_session}) with your answer…`,
            );
            let success = false;
            try {
              const { query } = await import("@anthropic-ai/claude-agent-sdk");
              for await (const msg of query({
                prompt: answer,
                options: {
                  cwd: worktreePath,
                  resume: fm.worker_session,
                  permissionMode: "bypassPermissions",
                },
              })) {
                const rec = msg as unknown as Record<string, unknown>;
                const line = summarizeEvent(rec);
                if (line) output.appendLine(`  [${h}] ${line}`);
                if (isResultSuccess(rec)) success = true;
              }
            } catch (err) {
              output.appendLine(`  ✗ resume failed: ${(err as Error).message}`);
            }
            // Return it to the loop so the next Orchestrate verifies + advances it.
            await store.writeFile(
              rel,
              { ...fm, status: "ready", needs_input: false },
              body,
            );
            vscode.window.showInformationMessage(
              success
                ? `${h}: resumed to completion — back to Ready for verify.`
                : `${h}: resume ended without a success result — back to Ready; re-attend if needed.`,
            );
            return;
          }

          // failed (requires-attention) → open a primed session in the worktree.
          await deps.launcher.openHere(
            vscode.Uri.file(worktreePath),
            buildAttendPrompt(h, extractDiagnosis(body)),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Attend failed: ${(err as Error).message}`,
          );
        }
      },
    ),
  );
}

/** Find requires-attention slices on the board and quick-pick one (or the only one). */
async function pickAttentionSlice(
  store: ThinkubeStore,
): Promise<string | undefined> {
  const handles: string[] = [];
  for (const specId of await store.listSpecDirs()) {
    for (const rel of await store.listSlices(specId)) {
      const fm = (await store.getFile(rel))?.frontmatter;
      if ((fm?.status ?? "") === "requires-attention") {
        const num = /SL-(\d+)\.md$/.exec(rel)?.[1];
        if (num) handles.push(store.sliceHandle(specId, Number(num)));
      }
    }
  }
  if (handles.length === 0) {
    vscode.window.showInformationMessage(
      "No requires-attention slices to attend.",
    );
    return undefined;
  }
  if (handles.length === 1) return handles[0];
  return vscode.window.showQuickPick(handles, {
    placeHolder: "Attend which requires-attention slice?",
  });
}

/**
 * Float a running (or finished) session into a webview panel beside the editor (SP-tgs8nz
 * AC7) — the user can "Move into New Window" onto a second monitor; on code-server, where the
 * aux-window route is unreliable, this beside-panel IS the dedicated-window fallback. It
 * renders the session's persisted `.jsonl` and live-tails it while the worker streams.
 */
function floatOutSession(
  context: vscode.ExtensionContext,
  handle?: string,
): void {
  const title = handle ? `Session · ${handle}` : "Orchestrator Session";
  const panel = vscode.window.createWebviewPanel(
    "thinkubeSession",
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { retainContextWhenHidden: true },
  );
  const logPath = handle ? sessionLogPath(handle) : undefined;

  const render = () => {
    const lines: string[] = [];
    if (logPath) {
      try {
        const buf = new StreamJsonBuffer();
        for (const evt of buf.push(fs.readFileSync(logPath, "utf8"))) {
          const s = summarizeEvent(evt);
          if (s) lines.push(s);
        }
      } catch {
        /* file not ready yet */
      }
    }
    const body = lines.length
      ? lines.map(esc).join("\n")
      : logPath
        ? "Waiting for session output…"
        : "No session log for this slice yet — run it via “Orchestrate Next Slice”.";
    panel.webview.html = sessionHtml(esc(title), body);
  };

  render();
  let watcher: fs.FSWatcher | undefined;
  if (logPath) {
    try {
      watcher = fs.watch(logPath, () => render());
    } catch {
      /* best-effort — the panel still shows what's there */
    }
  }
  panel.onDidDispose(() => watcher?.close());
  context.subscriptions.push(panel);
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

function sessionHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:13px var(--vscode-editor-font-family,monospace);padding:8px;color:var(--vscode-foreground)}h1{font-size:13px;opacity:.7}#log{white-space:pre-wrap}.hint{opacity:.5}</style></head><body><h1>${title}</h1><div id="log">${body}</div><p class="hint">Use the editor's “Move into New Window” to place this on a second monitor.</p></body></html>`;
}
