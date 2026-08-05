/**
 * The v2 session: owns one space, accepts exactly the registered actions,
 * and persists every change to the store as both faces — the machine face
 * (space.json) and the human abstracts rendered from it. Pure over its
 * dependencies; the VS Code panel is a thin shell around postMessage.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { emptySpace, Space, Unit } from "../core/schema";
import { addAsk } from "../core/intent";
import { formUnits, unitEdges } from "../core/cluster";
import { runGrounding } from "../derive/ground";
import { RoundDeps } from "../derive/round";
import { signCut, acceptDelivery } from "../gates/sign";
import { renderCutScreen, renderDeliveryPage } from "../gates/render";

export type SessionAction =
  | { action: "capture"; text: string }
  | { action: "select-unit"; unitId: string }
  | { action: "toggle-cut"; nodeIds: string[] }
  | { action: "sign-cut" }
  | { action: "accept-delivery"; deliveryId: string }
  | { action: "flip-face"; artifactId: string };

/** Every action name the session accepts — the reachability test's ground truth. */
export const SESSION_ACTIONS: string[] = [
  "capture",
  "select-unit",
  "toggle-cut",
  "sign-cut",
  "accept-delivery",
  "flip-face",
];

export interface SessionDeps {
  round: RoundDeps;
  storeDir: string;
  now: () => string;
  ground?: typeof runGrounding;
}

export class TandemSession {
  space: Space = emptySpace();
  units: Unit[] = [];
  edges: { from: string; to: string }[] = [];
  cutNodeIds = new Set<string>();

  constructor(private deps: SessionDeps) {
    this.load();
  }

  /** Capture an ask verbatim, ground it, recluster. */
  async capture(text: string): Promise<{ ok: boolean; reason?: string }> {
    const r = addAsk(this.space, text, this.deps.now());
    if (!r.ok) return { ok: false, reason: r.reason };
    this.space = r.space;
    const ground = this.deps.ground ?? runGrounding;
    const nodes = await ground(this.deps.round, r.added, {
      nextIndex: this.space.nodes.length + 1,
    });
    this.space = { ...this.space, nodes: [...this.space.nodes, ...nodes] };
    this.recluster();
    this.persist();
    return { ok: true };
  }

  recluster(): void {
    this.units = formUnits(this.space.nodes);
    this.edges = unitEdges(this.space.nodes, this.units);
    this.space = { ...this.space, units: this.units };
  }

  toggleCut(nodeIds: string[]): void {
    for (const id of nodeIds)
      if (this.cutNodeIds.has(id)) this.cutNodeIds.delete(id);
      else this.cutNodeIds.add(id);
    this.persist();
  }

  cutScreen(): string {
    return renderCutScreen(this.space, {
      id: `cut-${this.space.cuts.length + 1}`,
      nodeIds: [...this.cutNodeIds],
    });
  }

  signCut(): { ok: boolean; reason?: string } {
    const cut = {
      id: `cut-${this.space.cuts.length + 1}`,
      nodeIds: [...this.cutNodeIds],
    };
    const r = signCut(this.space, cut, this.deps.now());
    if (!r.ok) return r;
    this.space = { ...this.space, cuts: [...this.space.cuts, r.cut] };
    this.cutNodeIds.clear();
    this.persist();
    return { ok: true };
  }

  deliveryPage(deliveryId: string): string | undefined {
    const d = this.space.deliveries.find((x) => x.id === deliveryId);
    return d ? renderDeliveryPage(this.space, d) : undefined;
  }

  acceptDelivery(deliveryId: string): { ok: boolean; reason?: string } {
    const d = this.space.deliveries.find((x) => x.id === deliveryId);
    if (!d) return { ok: false, reason: `no delivery '${deliveryId}'` };
    const r = acceptDelivery(d, this.deps.now());
    if (!r.ok) return r;
    this.space = {
      ...this.space,
      deliveries: this.space.deliveries.map((x) =>
        x.id === deliveryId ? r.delivery : x,
      ),
    };
    this.persist();
    return { ok: true };
  }

  /** Both faces on disk: the data, and the abstracts rendered from it. */
  persist(): void {
    fs.mkdirSync(this.deps.storeDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.deps.storeDir, "space.json"),
      JSON.stringify(
        { space: this.space, cut: [...this.cutNodeIds] },
        null,
        2,
      ),
    );
  }

  load(): void {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.deps.storeDir, "space.json"), "utf8"),
      ) as { space: Space; cut: string[] };
      this.space = raw.space;
      this.cutNodeIds = new Set(raw.cut);
      this.recluster();
    } catch {
      this.space = emptySpace();
    }
  }
}
