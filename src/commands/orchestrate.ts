/**
 * `/orchestrate` command: dispatch the next Ready slice of a chosen Spec
 * via `OrchestratorService`. Thin vscode glue — resolves the active thinking space repo, the spec,
 * and the worktree/thinking space config, then calls `dispatchNext` and streams the worker's
 * JSON-log to an output channel. The dispatch logic + parsing are the unit-tested core;
 * the live worker outcome is the human's verdict.
 */
import * as vscode from "vscode";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { WorktreeService } from "../services/WorktreeService";
import {
  OrchestratorService,
  createSdkContractCheck,
  createSdkPlanRepair,
} from "../services/OrchestratorService";
import type { WorkerModelConfig } from "../services/workerModel";
import { resolveWorkerModel } from "../services/workerModel";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  extractDiagnosis,
  buildAttendPrompt,
  buildRejectPrompt,
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
  toolUseSummary,
  toolResultSummary,
} from "../services/orchestratorCore";

// markdown-it ships no bundled types; load it untyped (the extension is CommonJS).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require("markdown-it") as new (o?: {
  html?: boolean;
  linkify?: boolean;
  breaks?: boolean;
}) => { render(s: string): string };
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
import {
  sessionLogPathFor,
  answerParkedWorker,
} from "../services/orchestratorSessions";
import { createSdkAuditRunner } from "../services/auditorRunner";
import { loadOrCreateSecret } from "../services/acSignature";
import { writeSpec } from "../mcp/kanbanMcpServer";
import { showFreshMarkdownPreview } from "./freshPreview";
import { gateSpecAcceptance } from "../methodology/qualityGates";
import { mergeSpecPr, specBranch } from "../github/specMerge";
import { retireWorktreeNote } from "./acceptLand";
import type { OwnershipArbiter } from "../services/OwnershipArbiter";
import type { LauncherService } from "../services/LauncherService";
import type { SpecsProvider } from "../views/thinkingSpaces/SpecsProvider";
import { workingRepoPath, specRepoNamespace } from "../store/workingRepo";
import { ConcurrencyLock } from "../services/concurrencyLock";
import { withSpecLock } from "../services/dispatchGuard";

/**
 * One module-scope dispatch lock shared by `thinkube.orchestrate` and `thinkube.accept`: a second
 * invocation for the SAME Spec while one is in flight is refused via `withSpecLock`'s `onBusy`
 * (an "already running" notice), never double-dispatched. Different Specs are independent.
 */
const dispatchLock = new ConcurrencyLock();

/** Orchestrators with a run in flight — the Stop command reaches them here (the
 *  service is constructed per invocation, so a module-scope registry is the only
 *  shared handle a palette command can use). */
const liveOrchestrators = new Set<OrchestratorService>();

/** Normalize a spec arg from the ▶ button / a card — the tep-qualified handle
 *  `TEP-n_SP-m` — (or a bare / `SP-`-prefixed id) into the composite spec id
 *  `n/m` that `listSpecDirs` returns. The card carries the full handle, so the
 *  old `replace(/^SP-/, "")` left `TEP-5_SP-1` intact → "not a Spec on this thinking space". */
function normalizeSpecArg(arg: string): string {
  const raw = arg.trim();
  const m = /^TEP-(\d+)_SP-(\d+)$/.exec(raw);
  return m ? `${m[1]}/${m[2]}` : raw.replace(/^SP-/, "");
}

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
    // Human stop control (2026-07-14): before this, the only way to stop a run was
    // killing worker processes by hand. Aborts every in-flight worker and flags the
    // run to halt — it drains, finalizes, and records its bookkeeping (same semantics
    // as the failure-threshold halt; nothing is orphaned).
    vscode.commands.registerCommand("thinkube.orchestrate.stop", () => {
      if (liveOrchestrators.size === 0) {
        vscode.window.showInformationMessage(
          "No orchestration run is in flight.",
        );
        return;
      }
      let aborted = 0;
      for (const o of liveOrchestrators) aborted += o.requestHalt();
      output.appendLine(
        `■ STOP requested from the command palette — ${aborted} in-flight worker(s) aborted; the run drains and finalizes.`,
      );
      output.show(true);
      vscode.window.showInformationMessage(
        `Stop requested — ${aborted} in-flight worker(s) aborted; the run drains and finalizes.`,
      );
    }),
    vscode.commands.registerCommand(
      "thinkube.orchestrate",
      async (
        specArg?: string,
        thinkingSpaceCtx?: {
          root: string;
          thinkingSpaceDir: string;
          name: string;
        },
      ) => {
        // Prefer the panel's OWN thinking space (passed by the ▶ button) over the ambient sidebar
        // selection: the button must orchestrate the thinking space it's shown on, not whatever space
        // the sidebar happens to be scoped to (the "No Specs on this thinking space" mismatch).
        let repoPath: string;
        let thinkingSpaceDir: string;
        if (thinkingSpaceCtx) {
          repoPath = thinkingSpaceCtx.root;
          thinkingSpaceDir = thinkingSpaceCtx.thinkingSpaceDir;
        } else {
          const repo = deps.specsProvider.repoEntry;
          if (!repo || !repo.enabled) {
            vscode.window.showInformationMessage(
              "Select an enabled thinking space to orchestrate.",
            );
            return;
          }
          repoPath = repo.path;
          thinkingSpaceDir = repo.thinkingSpaceDir;
        }
        const arbiter = deps.getArbiter();
        if (!arbiter) {
          vscode.window.showWarningMessage(
            "Orchestrator not ready — the ownership arbiter is still activating. Try again in a moment.",
          );
          return;
        }
        try {
          const store = new ThinkubeStore(repoPath, thinkingSpaceDir);
          // listSpecDirs returns bare Spec ids (e.g. "tgxunl") — use them directly. The prior
          // `/SP-.../.exec` ran an SP-prefixed regex over an already-unprefixed id → always
          // undefined → empty, which is why orchestrate reported "No Specs" on every thinking space.
          const specs = await store.listSpecDirs();
          if (specs.length === 0) {
            vscode.window.showInformationMessage(
              "No Specs on this thinking space yet.",
            );
            return;
          }
          // From the ▶ button (control-center graph): a spec id is passed directly — skip the
          // quick-pick and orchestrate exactly the Spec the user clicked.
          let spec: string;
          if (typeof specArg === "string" && specArg.trim()) {
            spec = normalizeSpecArg(specArg);
            if (!specs.includes(spec)) {
              vscode.window.showWarningMessage(
                `SP-${spec} is not a Spec on this thinking space.`,
              );
              return;
            }
          } else {
            const specId =
              specs.length === 1
                ? specs[0]
                : await vscode.window.showQuickPick(
                    specs.map((id) => `SP-${id}`),
                    {
                      placeHolder: "Orchestrate which Spec's next Ready slice?",
                    },
                  );
            if (!specId) return;
            spec = specId.replace(/^SP-/, "");
          }

          // Guard against double-dispatch of the SAME Spec: a second orchestrate while one is in
          // flight is refused (the notice), the dispatch body never runs twice. Other Specs are
          // unaffected; the lock is released on completion and on throw.
          await withSpecLock(
            dispatchLock,
            spec,
            async () => {
              const wrp = await workingRepoPath(store, spec, repoPath);
              const canonical = (await worktrees.canonicalRepo(wrp)) ?? wrp;
              const baseDir =
                vscode.workspace
                  .getConfiguration("thinkube")
                  .get<string>("worktree.baseDir")
                  ?.trim() || undefined;
              const thinkingSpaceRoot =
                vscode.workspace
                  .getConfiguration("thinkube.thinkingSpace")
                  .get<string>("root")
                  ?.trim() || undefined;

              // SP-17/1: read the pinned, decoupled worker-model config once at the extension-host
              // boundary and thread it into the orchestrator's deps, so every worker (code/test-author,
              // assessor, judge, auditor) runs on this model rather than inheriting the session/env model.
              const orchestratorCfg = vscode.workspace.getConfiguration(
                "thinkube.orchestrator",
              );
              const workerModel: WorkerModelConfig = {
                workerModel:
                  orchestratorCfg.get<string>("workerModel")?.trim() ||
                  undefined,
                workerModelByRole:
                  orchestratorCfg.get<Record<string, string>>(
                    "workerModelByRole",
                  ) || undefined,
              };

              const orchestrator = new OrchestratorService({
                worktrees,
                arbiter,
                store,
                output,
                canonicalRepo: canonical,
                thinkingSpaceRoot,
                baseDir,
                workerModel,
                // Pre-flight contract-consistency check (2026-07-12): one independent
                // session per FRESH slice, before any worker dispatches — an authored
                // contradiction (a unit note an AC forbids) is caught at the cheapest
                // point instead of after every worker ran. Runs on the judge's model.
                checkContract: createSdkContractCheck({
                  cwd: canonical,
                  model: resolveWorkerModel(workerModel, "judge"),
                  log: (l) => output.appendLine(l),
                }),
                // Plan-repair lane (2026-07-12): when the judge attributes a red to the
                // PLAN (an instrument misserving the intent), this session proposes the
                // amendment; the orchestrator applies it, re-certifies, records it on
                // the card and in the delivery report's "Changes to the approved plan",
                // and re-grades — same run. The intent itself is never machine-amended.
                repairPlan: createSdkPlanRepair({
                  cwd: canonical,
                  model: resolveWorkerModel(workerModel, "judge"),
                  log: (l) => output.appendLine(l),
                }),
                verifyCommand: orchestratorCfg
                  .get<string>("verifyCommand")
                  ?.trim(),
                // Gate self-heal (2026-07-11): when the closing gate hits an
                // UNRUNNABLE probe (exit 126/127), re-author + re-sign the
                // Spec's ac_verifications via the same certify-only audit path
                // write_spec uses, then the gate retries once — a gate defect
                // never burns a rework attempt or blames a slice.
                reauthorGate: async (specNumber, worktreeCwd) => {
                  const keyDir = process.env.THINKUBE_SIGNING_KEY_DIR?.trim();
                  if (!keyDir) {
                    output.appendLine(
                      "⚠ gate re-author unavailable: THINKUBE_SIGNING_KEY_DIR is not set on the host.",
                    );
                    return false;
                  }
                  const runner = createSdkAuditRunner({
                    model:
                      workerModel.workerModelByRole?.auditor ??
                      workerModel.workerModel ??
                      "sonnet",
                    log: (l) => output.appendLine(l),
                  });
                  await writeSpec(
                    store,
                    specNumber,
                    undefined, // certify-only: audit + sign the on-disk body
                    undefined,
                    // The PRESENCE of ac_verifications is the "please certify
                    // now" signal; with signing on its VALUE is ignored (the
                    // server signs only what its own audit produced).
                    {},
                    undefined,
                    {
                      runner,
                      secret: loadOrCreateSecret(keyDir),
                      cwd: worktreeCwd,
                    },
                  );
                  return true;
                },
              });
              output.show(true);
              const cap =
                vscode.workspace
                  .getConfiguration("thinkube.orchestrator")
                  .get<number>("maxConcurrent") ?? 4;
              liveOrchestrators.add(orchestrator);
              const r = await orchestrator
                .dispatchSpec(spec, cap)
                .finally(() => liveOrchestrators.delete(orchestrator));
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
                    (r.needsInput.length
                      ? `, ${r.needsInput.length} need input`
                      : "") +
                    (r.attention.length
                      ? `, ${r.attention.length} need attention`
                      : "") +
                    (r.committed ? " — committed ✓" : ""),
                );
              }
              // On a completed Spec, auto-open the delivery summary in the Markdown PREVIEW (rendered)
              // — the post-execution "here's what was accomplished + what to do next" record. Use the
              // fresh-preview helper: DELIVERY.md is in the unwatched sidecar, so a stale preview from
              // the PRIOR run would otherwise be refocused with last run's content (the reported bug).
              if (r.deliveryDoc) {
                void showFreshMarkdownPreview(
                  vscode.Uri.file(path.join(thinkingSpaceDir, r.deliveryDoc)),
                );
              }
            },
            () =>
              vscode.window.showInformationMessage(
                `SP-${spec} is already running.`,
              ),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Orchestrate failed: ${(err as Error).message}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "thinkube.floatOutSession",
      (handle?: string) => floatOutSession(context, handle),
    ),
    vscode.commands.registerCommand(
      "thinkube.attend",
      async (
        handle?: string,
        thinkingSpaceCtx?: {
          root: string;
          thinkingSpaceDir: string;
          name: string;
        },
      ) => {
        let repoPath: string;
        let thinkingSpaceDir: string;
        if (thinkingSpaceCtx) {
          repoPath = thinkingSpaceCtx.root;
          thinkingSpaceDir = thinkingSpaceCtx.thinkingSpaceDir;
        } else {
          const repo = deps.specsProvider.repoEntry;
          if (!repo || !repo.enabled) {
            vscode.window.showInformationMessage(
              "Select an enabled thinking space to attend a slice.",
            );
            return;
          }
          repoPath = repo.path;
          thinkingSpaceDir = repo.thinkingSpaceDir;
        }
        try {
          const store = new ThinkubeStore(repoPath, thinkingSpaceDir);
          const h = handle ?? (await pickAttentionSlice(store));
          if (!h) return;
          const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(h);
          if (!m) {
            vscode.window.showErrorMessage(`Bad slice handle "${h}".`);
            return;
          }
          const specId = `${m[1]}/${m[2]}`;
          const rel = store.pathForSlice(specId, Number(m[3]));
          const parsed = await store.getFile(rel);
          const fm = (parsed?.frontmatter ?? {}) as Record<string, unknown>;
          const body = parsed?.body ?? "";

          const wrp = await workingRepoPath(store, specId, repoPath);
          const canonical = (await worktrees.canonicalRepo(wrp)) ?? wrp;
          const baseDir =
            vscode.workspace
              .getConfiguration("thinkube")
              .get<string>("worktree.baseDir")
              ?.trim() || undefined;
          const thinkingSpaceRoot =
            vscode.workspace
              .getConfiguration("thinkube.thinkingSpace")
              .get<string>("root")
              ?.trim() || undefined;
          const worktreePath = await worktrees.create(
            canonical,
            specId,
            baseDir,
            thinkingSpaceRoot,
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
            // verifies + advances it. No thinking space write needed here.
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

          // failed (requires-attention) → open a primed session in the
          // CANONICAL repo (2026-07-11), not the disposable worktree: the
          // worktree dies at Accept and used to take the session's cwd with
          // it (the whole "close this session before orchestrating" ritual).
          // The prompt carries the worktree path — the fix is applied there
          // and committed to the spec branch; the session outlives it.
          await deps.launcher.openHere(
            vscode.Uri.file(canonical),
            buildAttendPrompt(h, extractDiagnosis(body), worktreePath),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Attend failed: ${(err as Error).message}`,
          );
        }
      },
    ),
    // Accept: the human's "land it" on the closing delivery report. The
    // gated merge — refuse unless every AC is checked + every slice Done (gateSpecAcceptance),
    // then merge spec/SP-{n} → main and stamp `accepted:`. Mirrors thinkingSpaces.ts onAcceptSpec, but
    // wired through a command so the report surface can post `accept` like orchestrate/attend.
    vscode.commands.registerCommand(
      "thinkube.accept",
      async (
        spec?: string,
        thinkingSpaceCtx?: {
          root: string;
          thinkingSpaceDir: string;
          name: string;
        },
      ) => {
        if (typeof spec !== "string" || !spec.trim()) {
          vscode.window.showErrorMessage("Accept: no Spec id provided.");
          return;
        }
        const specId = normalizeSpecArg(spec);
        let repoPath: string;
        let thinkingSpaceDir: string;
        if (thinkingSpaceCtx) {
          repoPath = thinkingSpaceCtx.root;
          thinkingSpaceDir = thinkingSpaceCtx.thinkingSpaceDir;
        } else {
          const repo = deps.specsProvider.repoEntry;
          if (!repo || !repo.enabled) {
            vscode.window.showInformationMessage(
              "Select an enabled thinking space to accept a Spec.",
            );
            return;
          }
          repoPath = repo.path;
          thinkingSpaceDir = repo.thinkingSpaceDir;
        }
        try {
          // Guard against double-accept of the SAME Spec: a second accept while one is in flight
          // is refused (the notice), the gated-merge body never runs twice. Released on completion
          // and on throw.
          await withSpecLock(
            dispatchLock,
            specId,
            async () => {
              const store = new ThinkubeStore(repoPath, thinkingSpaceDir);
              const specRel = store.pathForSpecDoc(specId);
              const specDoc = await store.getFile(specRel);
              if (!specDoc) {
                vscode.window.showErrorMessage(
                  `No spec at ${specRel} — nothing to accept.`,
                );
                return;
              }
              const sliceStatuses: string[] = [];
              for (const rel of await store.listSlices(specId)) {
                const parsed = await store.getFile(rel);
                sliceStatuses.push(String(parsed?.frontmatter?.status ?? ""));
              }
              // Refuse unless every AC is checked (and every slice Done) — no accept of an
              // unverified Spec.
              const gate = gateSpecAcceptance({
                specBody: specDoc.body,
                sliceStatuses,
              });
              if (!gate.ok) {
                vscode.window.showWarningMessage(
                  `SP-${specId}: ${gate.reason}`,
                );
                return;
              }
              // Merge first, stamp second: a failed merge throws, and we must never leave a
              // Spec stamped accepted while its branch is still open (mergeSpecPr returns
              // without merging when there is simply no PR — shipped straight to main).
              // Git ops run in the spec's WORKING repo (`repo:`), not the thinking space dir — a
              // project member's branch/worktree live in a different repo than its thinking space.
              const wrp = await workingRepoPath(store, specId, repoPath);
              output.appendLine(
                `▸ accept SP-${specId}: gate ok — merging in working repo ${wrp} (branch ${specBranch(specId)})…`,
              );
              const merge = await mergeSpecPr(specId, wrp);
              output.appendLine(
                `▸ accept SP-${specId}: merge result — ${JSON.stringify(merge)}`,
              );
              await store.writeFile(
                specRel,
                { ...specDoc.frontmatter, accepted: new Date().toISOString() },
                specDoc.body,
              );
              const retireNote = merge.merged
                ? await retireWorktreeNote(worktrees, wrp, specId)
                : "";
              vscode.window.showInformationMessage(
                merge.merged
                  ? `Accepted SP-${specId} — ${merge.opened ? "opened + merged" : "merged"} ${merge.branch}${merge.output ? `: ${merge.output}` : ""}.${retireNote}`
                  : `Accepted SP-${specId} — no PR to merge (shipped straight to main).`,
              );
            },
            () =>
              vscode.window.showInformationMessage(
                `SP-${specId} is already running.`,
              ),
          );
        } catch (err) {
          // Durable diagnostics (the toast is transient): log the full error + stack to the
          // output channel so an accept failure is inspectable after the fact.
          const e = err as Error;
          output.appendLine(
            `✗ accept SP-${specId} FAILED: ${e.message}\n${e.stack ?? "(no stack)"}`,
          );
          output.show(true);
          vscode.window.showErrorMessage(
            `Accept SP-${specId} failed: ${e.message}`,
          );
        }
      },
    ),
    // Reject: the spec-level analog of `/attend`. Open a Claude session in the
    // Spec's worktree primed with the delivery report (DELIVERY.md) so the rework starts from the
    // per-AC verdicts + caught problems the orchestrator recorded.
    vscode.commands.registerCommand(
      "thinkube.reject",
      async (
        spec?: string,
        thinkingSpaceCtx?: {
          root: string;
          thinkingSpaceDir: string;
          name: string;
        },
      ) => {
        if (typeof spec !== "string" || !spec.trim()) {
          vscode.window.showErrorMessage("Reject: no Spec id provided.");
          return;
        }
        const specId = normalizeSpecArg(spec);
        let repoPath: string;
        let thinkingSpaceDir: string;
        if (thinkingSpaceCtx) {
          repoPath = thinkingSpaceCtx.root;
          thinkingSpaceDir = thinkingSpaceCtx.thinkingSpaceDir;
        } else {
          const repo = deps.specsProvider.repoEntry;
          if (!repo || !repo.enabled) {
            vscode.window.showInformationMessage(
              "Select an enabled thinking space to reject a Spec.",
            );
            return;
          }
          repoPath = repo.path;
          thinkingSpaceDir = repo.thinkingSpaceDir;
        }
        try {
          const store = new ThinkubeStore(repoPath, thinkingSpaceDir);
          // The delivery report is the rejection's context. Best-effort: a Spec that hasn't
          // been orchestrated yet has none — we still open a primed session (the prompt notes
          // the absence) so Reject always launches.
          const reportRel = store
            .pathForSpecDoc(specId)
            .replace(/spec\.md$/, "DELIVERY.md");
          let report: string | undefined;
          try {
            report = fs.readFileSync(
              path.join(store.thinkubeDir, reportRel),
              "utf8",
            );
          } catch {
            report = undefined;
          }

          const wrp = await workingRepoPath(store, specId, repoPath);
          const canonical = (await worktrees.canonicalRepo(wrp)) ?? wrp;
          const baseDir =
            vscode.workspace
              .getConfiguration("thinkube")
              .get<string>("worktree.baseDir")
              ?.trim() || undefined;
          const thinkingSpaceRoot =
            vscode.workspace
              .getConfiguration("thinkube.thinkingSpace")
              .get<string>("root")
              ?.trim() || undefined;
          const worktreePath = await worktrees.create(
            canonical,
            specId,
            baseDir,
            thinkingSpaceRoot,
          );

          // A project-member Spec lives on the cross-repo PROJECT thinking space, not on
          // this worktree's repo thinking space — so the rework session must address it by
          // id (the session's cwd thinking space is the working repo). Name that thinking space in
          // the prompt for a project member (the spec carries `repo:`); a normal
          // same-repo Spec is on this worktree's own thinking space → no extra naming.
          const specRepo = await specRepoNamespace(store, specId);
          const projectThinkingSpaceId =
            specRepo && thinkingSpaceRoot
              ? path
                  .relative(thinkingSpaceRoot, store.thinkubeDir)
                  .split(path.sep)
                  .join("/")
              : undefined;
          // Session in the CANONICAL repo (2026-07-11) — survives worktree
          // retirement; the prompt names the worktree the rework lands in.
          await deps.launcher.openHere(
            vscode.Uri.file(canonical),
            buildRejectPrompt(specId, report, projectThinkingSpaceId, worktreePath),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Reject SP-${specId} failed: ${(err as Error).message}`,
          );
        }
      },
    ),
  );
}

/** Find requires-attention slices on the thinking space and quick-pick one (or the only one). */
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
 * Float a running (or finished) session into a webview panel beside the editor (
 * AC7) — the user can "Move into New Window" onto a second monitor; on code-server, where the
 * aux-window route is unreliable, this beside-panel IS the dedicated-window fallback. It
 * renders the session's persisted `.jsonl` and live-tails it while the worker streams.
 */
function floatOutSession(
  context: vscode.ExtensionContext,
  handle?: string,
): void {
  const title = handle ? `Session · ${handle}` : "Orchestrator Session";
  const toNewWindow = vscode.workspace
    .getConfiguration("thinkube.orchestrator")
    .get<boolean>("floatLogsToNewWindow", true);
  const panel = vscode.window.createWebviewPanel(
    "thinkubeSession",
    title,
    // Active (focused) when we're about to pop it into its own window; Beside (unfocused) otherwise.
    toNewWindow
      ? vscode.ViewColumn.Active
      : { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { retainContextWhenHidden: true },
  );
  const logPath = handle ? sessionLogPathFor(handle) : undefined;

  const render = () => {
    const events: Record<string, unknown>[] = [];
    const exists = logPath ? fs.existsSync(logPath) : false;
    if (exists && logPath) {
      try {
        const buf = new StreamJsonBuffer();
        for (const evt of buf.push(fs.readFileSync(logPath, "utf8")))
          events.push(evt);
      } catch {
        /* file not ready yet */
      }
    }
    const inner = events.length
      ? renderEventsHtml(events)
      : `<p class="hint">${
          exists
            ? "Waiting for session output…"
            : "No log for this worker yet — it hasn't run (dispatch the Spec to start it)."
        }</p>`;
    panel.webview.html = sessionHtml(esc(title), inner);
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

  // Pop the log directly into its own window — the "float out" intent — instead of leaving it a
  // beside tab the user must "Move into New Window" by hand. Best-effort: a graceful no-op where
  // the command / auxiliary windows aren't supported (the panel just stays as a tab).
  if (toNewWindow) {
    void Promise.resolve(
      vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow"),
    ).then(undefined, () => undefined);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

/** Render a worker's session events as a legible transcript: assistant prose as formatted
 *  markdown, each tool call as a styled command line, each tool result as a dimmed snippet. */
function renderEventsHtml(events: Record<string, unknown>[]): string {
  const out: string[] = [];
  for (const evt of events) {
    if (evt.type === "system" && evt.subtype === "init") {
      out.push(`<div class="ev sys">▸ session started</div>`);
      continue;
    }
    if (evt.type === "assistant") {
      const msg = evt.message as { content?: unknown } | undefined;
      const content = Array.isArray(msg?.content) ? msg!.content : [];
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "text" && typeof b.text === "string" && b.text.trim())
          out.push(`<div class="ev say">${md.render(b.text)}</div>`);
        if (b.type === "tool_use" && typeof b.name === "string")
          out.push(
            `<div class="ev tool">${esc(toolUseSummary(b.name, b.input))}</div>`,
          );
      }
      continue;
    }
    if (evt.type === "user") {
      const msg = evt.message as { content?: unknown } | undefined;
      const content = Array.isArray(msg?.content) ? msg!.content : [];
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "tool_result") {
          const s = toolResultSummary(b);
          if (s)
            out.push(
              `<div class="ev res${b.is_error === true ? " err" : ""}">${esc(s.trim())}</div>`,
            );
        }
      }
      continue;
    }
    if (evt.type === "result") {
      out.push(
        `<div class="ev final">${
          isResultSuccess(evt)
            ? "✓ result: success"
            : "✗ result: " + esc(String(evt.subtype ?? "error"))
        }</div>`,
      );
    }
  }
  return out.join("\n");
}

function sessionHtml(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:13px var(--vscode-font-family,sans-serif);line-height:1.5;padding:10px 16px;color:var(--vscode-foreground)}
    h1{font-size:13px;font-weight:600;opacity:.7;margin:0 0 12px}
    .ev{margin:0 0 9px}
    .ev.say>:first-child{margin-top:0}.ev.say>:last-child{margin-bottom:0}
    .ev.say :is(h1,h2,h3,h4){font-size:1.05em;font-weight:600;margin:.7em 0 .35em}
    .ev.say ul,.ev.say ol{margin:.3em 0;padding-left:1.4em}
    .ev.say pre{background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.15));padding:8px 10px;border-radius:4px;overflow:auto}
    .ev.say code{font-family:var(--vscode-editor-font-family,monospace);background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.15));padding:1px 4px;border-radius:3px;font-size:.92em}
    .ev.say pre code{background:none;padding:0}
    .ev.tool{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre-wrap;border-left:2px solid var(--vscode-terminal-ansiBlue,#4ea1f3);padding:1px 0 1px 8px;opacity:.85}
    .ev.res{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre-wrap;color:var(--vscode-descriptionForeground,#9aa);padding-left:14px}
    .ev.res.err{color:var(--vscode-errorForeground,#f66)}
    .ev.sys{opacity:.5}
    .ev.final{font-weight:600;margin-top:12px}
    .hint{opacity:.5;margin-top:16px;font-size:12px}
    a{color:var(--vscode-textLink-foreground)}
  </style></head><body><h1>${title}</h1>${inner}<p class="hint">Tip: drag this tab into its own editor group, or open a second code-server browser window, to place it on another monitor.</p></body></html>`;
}
