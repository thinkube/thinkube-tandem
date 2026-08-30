/**
 * What the surface sends back, and what the host does with it. Every
 * action is checked against the phase first: a press the surface let
 * through by mistake never starts work the phase forbids.
 */
import { TandemSession } from "./session";
import { phaseOf, refusedNow } from "./phase";
import { vs } from "./panel";

export interface InboundAction {
  action: string;
  text?: string;
  kind?: string;
  items?: string[];
  unitId?: string;
  questionId?: string;
  pinKind?: string;
  /** exempt-docs carries the person's words for why documentation is not
   *  needed — its own field, never the generic `text`. */
  reason?: string;
  // answer-worker carries unitId + text; stop-run carries nothing.
  changeIds?: string[];
  deliveryId?: string;
  /** attest: which promise the person is answering, and their verdict. */
  criterionId?: string;
  held?: boolean;
  proposalId?: string;
  impactId?: string;
  stepId?: string;
  page?: number;
  into?: string;
}
import type { PanelHostHooks } from "./panel";

export async function handleInbound(
  session: TandemSession,
  msg: InboundAction,
  push: (message?: string) => void,
  hooks?: PanelHostHooks,
): Promise<void> {
  // The host refuses what the phase does not allow — a press the surface
  // let through by mistake never starts work it must not start.
  const refusal = refusedNow(msg.action, phaseOf(session));
  if (refusal) {
    push(refusal);
    return;
  }
  if (msg.action === "switch-repo") {
    await hooks?.onSwitchRepo?.();
    return;
  }
  let note: string | undefined;
  if (msg.action === "save-draft") {
    // Typing costs nothing and interrupts nothing: the words are kept and
    // the surface is not told anything it does not already know.
    session.saveDraft(msg.text ?? "");
    return;
  } else if (msg.action === "read-draft") {
    push("Reading what you wrote…");
    const r = await session.readDraft();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "keep-draft") {
    const r = session.keepDraft();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "cancel-capture") {
    session.cancelCapture();
    note = "Cancelled.";
  } else if (msg.action === "build") {
    push("Building…");
    const r = await session.build(msg.changeIds ?? []);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "think") {
    const c = session.thinkingCost();
    push(
      c.subjects
        ? `Thinking about ${c.subjects} object(s) — about ${c.rounds} rounds…`
        : "Thinking…",
    );
    const r = await session.think();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "reframe" && msg.unitId && msg.text) {
    push("Reading it again…");
    const r = await session.reframe(msg.unitId, msg.text);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "amend" && msg.unitId && msg.text) {
    push("Recording the amendment…");
    const r = await session.amend(msg.unitId, msg.text);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "accept-delivery" && msg.deliveryId) {
    const r = await session.acceptDelivery(msg.deliveryId);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "attest" && msg.deliveryId && msg.criterionId) {
    const r = session.attestDelivery(msg.deliveryId, msg.criterionId, msg.held === true, msg.reason);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "reject-delivery" && msg.deliveryId) {
    const r = session.rejectDelivery(msg.deliveryId);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "accept-question" && msg.questionId) {
    push("Recording the decision…");
    const r = await session.acceptQuestion(msg.questionId, msg.text);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "answer-worker" && msg.unitId && msg.text) {
    // The one place an answer can land tells you what happened to it: it
    // reaches the parked worker, or the worker is no longer waiting and
    // nothing is delivered — never a silent vanish.
    const delivered = session.answerWorker(msg.unitId, msg.text);
    note = delivered ? undefined : "That worker is no longer waiting for an answer.";
  } else if (msg.action === "dismiss-promise") {
    const r = session.editModel({
      kind: msg.action,
      id: msg.unitId ?? "",
      ...(msg.text ? { text: msg.text } : {}),
    });
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "retry-model") {
    push("Reading your list again…");
    const r = await session.retryModel();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "read-log") {
    session.readLog(msg.stepId ?? null);
  } else if (msg.action === "stop-run") {
    session.stopRun();
  } else if (msg.action === "accept-impact" && msg.impactId) {
    push("Re-deriving under the decision…");
    const r = await session.decideImpact(msg.impactId, true);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "dismiss-impact" && msg.impactId) {
    const r = await session.decideImpact(msg.impactId, false);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "apply-all-impacts") {
    const r = await session.applyAllImpacts();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "exempt-docs") {
    const r = session.exemptDocs(msg.reason ?? "");
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "panic") {
    const r = session.panic();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "open-cut-review") {
    const doc = await vs().workspace.openTextDocument({
      content: session.cutScreen(),
      language: "markdown",
    });
    await vs().window.showTextDocument(doc, { preview: true });
  } else if (msg.action === "propose-check") {
    const r = await session.proposeCheckFor(msg.changeIds?.[0] ?? "");
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "accept-check") {
    session.acceptCheck(
      msg.changeIds?.[0] ?? "",
      msg.text ?? "",
      msg.kind === "assessment" ? "assessment" : "probe",
    );
  } else if (msg.action === "think-again") {
    push("Withdrawing the signed cut and thinking its promises through again…");
    const r = await session.thinkAgain();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "rerun") {
    push("Starting the signed work again…");
    const r = await session.rerun();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "reground") {
    push("Re-grounding…");
    await session.reground();
  }
  push(note);
}


