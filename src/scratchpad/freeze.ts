import { createHmac } from "node:crypto";
import { loadOrCreateSecret } from "../services/acSignature";
import type { ThinkubeStore } from "../store/ThinkubeStore";
import type { Frontmatter } from "../store/frontmatter";
import type { WorkingModel } from "./model";
import { freezeEnabled } from "./model";
import { projectDelta } from "./projection";

/**
 * A human-approval token. Any non-null token means "the human approved."
 * Only the UI (FreezeControl) may mint one — the assistant has no path to do so.
 */
export interface ApprovalToken {
  value: string;
}

/**
 * The server-side signing tool that stamps and writes the frozen artifact.
 * (SP-21/3 contract — part 4)
 */
export interface SigningTool {
  /** Appends a provenance stamp line to body and returns the result. */
  stamp(body: string): string;
  writeTep(args: {
    thinking_space: string;
    title: string;
    status: string;
    body: string;
  }): Promise<{ tep: string }>;
}

/**
 * Build a production SigningTool over ThinkubeStore and the same secret
 * mechanism the spec-certification signatures use.
 *
 * stamp() computes an HMAC-SHA256 over the body using a secret loaded (or
 * created) from secretDir, then appends:
 *   <!-- frozen: hmac-sha256:<hex> -->
 *
 * writeTep() mints the next TEP id via store.nextTepId(), writes the TEP
 * file via store.writeFile(), and returns { tep: "TEP-<id>" }.
 */
export function makeServerSigningTool(
  store: ThinkubeStore,
  secretDir: string,
): SigningTool {
  return {
    stamp(body: string): string {
      const secret = loadOrCreateSecret(secretDir);
      const hex = createHmac("sha256", secret).update(body).digest("hex");
      return `${body}\n<!-- frozen: hmac-sha256:${hex} -->`;
    },

    async writeTep(args: {
      thinking_space: string;
      title: string;
      status: string;
      body: string;
    }): Promise<{ tep: string }> {
      const tepId = await store.nextTepId();
      const sessionRel = store.pathForTep(tepId);

      const existing = await store.getFile(sessionRel);

      let body = args.body.trim();
      if (!body && existing?.body) {
        body = existing.body;
      }

      const fm: Frontmatter = existing?.frontmatter
        ? { ...existing.frontmatter }
        : {
            kind: "tep",
            id: `TEP-${tepId}`,
            status: "proposed",
            created: new Date().toISOString().slice(0, 10),
            implemented_by: [],
          };
      if (!fm.kind) fm.kind = "tep";
      if (!fm.id) fm.id = `TEP-${tepId}`;
      if (args.title) fm.title = args.title;
      if (args.status) fm.status = args.status as Frontmatter["status"];

      const finalBody = body.endsWith("\n") ? body : `${body}\n`;
      await store.writeFile(sessionRel, fm, finalBody);

      return { tep: `TEP-${tepId}` };
    },
  };
}

/**
 * Dependencies injected into freeze().
 */
export interface FreezeDeps {
  /** The human-approval token minted by the UI; null if the human has not approved. */
  approval: ApprovalToken | null;
  /** The server-side signing tool. */
  signing: SigningTool;
  /** The thinking space identifier passed to the signing tool. */
  thinkingSpace: string;
}

/**
 * Human-only signed freeze — implements the SP-21/3 freeze pipeline:
 *   assert freezeEnabled → projectDelta → stamp → writeTep(status:proposed)
 *   → returns { tep, itemIds } so the caller can dispatch stampShipped and save.
 *
 * Throws if:
 *   - `deps.approval` is null (no human approval token provided), or
 *   - `freezeEnabled(model)` is false (coverage or clean-cut requirement not met).
 *
 * Otherwise:
 *   1. Projects the checked, still-active items via projectDelta().
 *   2. Stamps the body via deps.signing.stamp().
 *   3. Calls deps.signing.writeTep with title, status:"proposed", stamped body.
 *   4. Returns { tep, itemIds } — the caller dispatches stampShipped and saves.
 */
export async function freeze(
  model: WorkingModel,
  deps: FreezeDeps,
): Promise<{ tep: string; itemIds: string[] }> {
  if (deps.approval === null) {
    throw new Error("Freeze requires a human approval token: approval is null");
  }

  if (!freezeEnabled(model)) {
    throw new Error(
      "Freeze is not enabled: the model has not passed the readiness check (coverage and clean-cut required)",
    );
  }

  const { title, body, itemIds } = projectDelta(model);
  const stamped = deps.signing.stamp(body);

  const result = await deps.signing.writeTep({
    thinking_space: deps.thinkingSpace,
    title,
    status: "proposed",
    body: stamped,
  });

  return { tep: result.tep, itemIds };
}
