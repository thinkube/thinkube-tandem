/**
 * Everything a session is given: the round runner, the store homes, the
 * forge, the injectable judgment rounds, and the §7quater scope wiring.
 */
import { SourceStamp } from "../core/stamp";
import { runDerivationPipeline } from "../derive/pipeline";
import { RoundDeps, runReadRound } from "../derive/round";
import { Forge } from "../dispatch/forge";
import { dispatchTep } from "../run/dispatch";
import { WorkerModelConfig } from "../engine/workerModel";
import { classifyUtterance } from "../derive/classify";
import { solveModel } from "../derive/model";
import { proposeCheck as proposeCheckRound } from "../derive/checks";

export interface SessionDeps {
  round: RoundDeps;
  storeDir: string;
  /** Machine-local secret + token store home (globalStorage in the host). */
  storageDir: string;
  now: () => string;
  /** Author identity (git user.name), for author-scoped TEP numbers. */
  author?: string;
  /** The forge for this repo; absent means deliveries stay local branches. */
  forge?: Forge;
  suiteCommand?: string[];
  ground?: typeof runDerivationPipeline;
  dispatch?: typeof dispatchTep;
  readCurrentStamp?: () => Promise<SourceStamp[]>;
  /** Retire a merged TEP's worktrees (best-effort; injectable). */
  retire?: (tepId: string) => Promise<void>;
  workerModel?: WorkerModelConfig;
  /** Frontier width for the run (v1 default 4). */
  maxConcurrent?: number;
  docsGateMode?: "blocking" | "advisory";
  classify?: typeof classifyUtterance;
  answerRound?: typeof runReadRound;
  /** The round that reads the repository for the shared digest. */
  contextRound?: typeof runReadRound;
  /** The round that reads a pasted list as one description. */
  solveModel?: typeof solveModel;
  proposeCheck?: typeof proposeCheckRound;
  nextTepNumber?: () => number; // owner-level, unique across the owner's spaces
  anchorless?: boolean; // a project space: the anchor is the store, never a code home
  scopes?: () => { id: string; dir: string; label?: string }[]; // project space's checked repos, read live
  /** §7quater: grounding reads the anchor dir; git ops run at gitRoot. */
  scope?: { gitRoot: string; prefix: string; projectId: string; label: string };
  /** Member scope id → its open repository; undefined = not open here. */
  resolveScope?: (
    scopeId: string,
  ) => Promise<{ gitRoot: string; prefix: string; forge?: Forge } | undefined>;
  /** The fold dir holding every user's subtree; absent = single-user. */
  projectDir?: string;
  /** Called after every state change so the panel can re-push. */
  onChanged?: (message?: string) => void;
}
