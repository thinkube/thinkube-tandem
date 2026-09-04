import type { TreeShape } from "../gates/moduleSizes";
/**
 * The core artifacts of Tandem: asks, nodes, units, cuts, work orders,
 * deliveries. Three rules shape every type here:
 *  - asks are the human's words, verbatim — no field the machine rewrites;
 *  - grounding anchors are structural (path + symbol), never line numbers;
 *  - every derived thing carries a stamp so its currency is checkable.
 */
import type { SourceStamp } from "./stamp";

export interface Ask {
  id: string;
  /** The human's words, byte for byte. */
  text: string;
  /** ISO timestamp of capture. */
  at: string;
  /**
   * The ask this one supersedes. A sentence whose work is signed can never
   * be edited — the record depends on it — so a change to what it asked
   * for arrives as a new sentence pointing back at the old one.
   */
  amends?: string;
}

/**
 * One place a change lands. `symbol` is a symbol path inside the file
 * ("reduce › case grow"); line numbers are rendered from anchors at the
 * moment of use and never stored.
 */
export interface Anchor {
  path: string;
  symbol?: string;
  /** The file does not exist yet — grounding against planned structure.
   *  Planned anchors are exempt from stamp acceptance until the file is born. */
  planned?: boolean;
  /** Project scope id (§7quater) — absent means the anchor scope. A slice
   *  never crosses scopes; a change never mixes them. */
  scope?: string;
  /** What the grounding round SAW here — one sentence: what is at this
   *  anchor and why the change lands on it. The round had the file open;
   *  without this field its reading dies with its transcript and every
   *  later consumer re-reads the same code to reconstruct it. */
  evidence?: string;
}

/** Refuses anchors that smuggle in positions (line/column suffixes). */
export function validateAnchor(a: Anchor): string | undefined {
  if (!a.path.trim()) return "anchor has an empty path";
  if (/[:#]L?\d+\s*$/.test(a.path))
    return `anchor path carries a position ("${a.path}") — anchors are structural; lines are rendered at use`;
  return undefined;
}

interface Grounding {
  touchpoints: Anchor[];
  stamp: SourceStamp[];
}

/** Where a check's standing proof lives, once the delivery that minted it
 *  is over: a test in the repository's own suite, at the module's test
 *  home, addressed by file and test name. The event side points into
 *  subject space — never the reverse — so the suite carries no delivery
 *  bookkeeping and a withdrawn claim can enumerate its tests to retire. */
export interface ProofAnchor {
  path: string;
  /** The test's name inside that file, as the harness reports it. */
  test?: string;
  /** The repo state the binding was made against — a moved or renamed
   *  test surfaces as drift, not as silence. */
  stamp: SourceStamp[];
}

/** What proves a promise kept. `probePath` binds the executable form;
 *  kind "assessment" marks a check no runnable test fits — graded at the
 *  closing gate by a fresh, independent assessor, never the builder.
 *  `proof` is where the check went on living after its delivery. */
export interface AcceptanceCriterion {
  id: string;
  text: string;
  probePath?: string;
  kind?: "probe" | "assessment";
  /**
   * Where this criterion is SETTLED, when that is not here.
   *
   * A worktree can only prove what runs in a worktree. On this platform
   * most promises are finally settled elsewhere: an app's tests run in a
   * named image in the build pipeline the merge fires; a component is
   * validated by its own 18_test.yaml against the live cluster; an
   * installer is proved by a person installing it. Before this field,
   * every such criterion was forced into here-shaped checks — and a run
   * on any non-local target withheld deliveries for the machine's own
   * limits. Free text naming the settling source, decided at grounding
   * from the target's downstream, shown to the person at signing.
   */
  settledBy?: string;
  proof?: ProofAnchor;
}

/**
 * One grounded intended change: a sentence for the human, grounding
 * underneath, edges to the asks it serves and the nodes it needs, and the
 * acceptance that will prove it.
 */
export interface Change {
  id: string;
  /** The human-facing sentence — a render, restamped when inputs move. */
  sentence: string;
  /** Ask ids this node serves. Empty = orphan, flagged as scope creep. */
  serves: string[];
  /** The claim or rule this promise makes true. Exactly one; a promise
   *  serving nothing is scope creep and is flagged as such. */
  servesClaim?: string;
  /** Node ids this node needs built first. */
  needs: string[];
  grounding?: Grounding;
  /** Only checks the machine can verify: runnable probes and assessments a
   *  reviewer can read from the delivered files. */
  acceptance: AcceptanceCriterion[];
  /** Effects of this promise the machine cannot verify — they need the
   *  running product, or act on the world — with the reason why. Not
   *  checks: notes, reported on the delivery as not verified. The machine
   *  never assigns the person a check. */
  unverified?: { text: string; why: string }[];
}

/** Nodes clustered by real coupling: shared touchpoints and edges. */
export interface Unit {
  id: string;
  changeIds: string[];
  /** Rendered title/abstract with the stamp of the inputs they described.
   *  `of` records the member set the render described — membership moving
   *  past it is what makes the render stale and due for re-naming. */
  abstract?: { title: string; text?: string; stamp: SourceStamp[]; of?: string[] };
}

/** A signed selection of changes to build now. Signing mints the TEP. */
export interface Cut {
  id: string;
  changeIds: string[];
  /** The set this cut was chosen from, when it was chosen from one. Absent
   *  on a cut assembled promise by promise, which is still allowed — the
   *  grouping is an offer, not a gate. */
  specId?: string;
  /** The minted TEP identity (author-scoped, permanent): TEP-<user>-<n>. */
  tepId?: string;
  /** Set when the human signs; binds the render AND the grounded members. */
  /** When the person withdrew this signed cut to think again. A withdrawn
   *  cut freezes nothing and runs nothing; its promises are derived anew
   *  and signed as a new cut. Only a cut that delivered nothing can be
   *  withdrawn. */
  withdrawnAt?: string;
  /** The recorded reason documentation is not needed for this cut. Set
   *  before signing, by the person's own words — the only way past the
   *  documentation rule for a cut that grounds no docs/ touchpoint. Once
   *  the cut is signed, this reason is covered by the signature: a later
   *  edit to it is drift, not a quiet change. */
  docsExemption?: { reason: string; at: string };
  signature?: {
    at: string;
    renderHash: string;
    groundingHash: string;
    /** Which rule computed those two hashes. When the machine changes what
     *  it hashes — a new line on the cut review, a field no longer counted —
     *  every older signature stops matching for a reason that has nothing to
     *  do with the person or the promises. A signature from an older rule is
     *  therefore not checked for drift, and says so, instead of refusing a
     *  run for the machine's own change. */
    rule?: number;
  };
}

/**
 * "unjudged" is not a failure. The check could not be RUN — no assessor
 * could be dispatched, one threw, the runner was missing, the run was
 * stopped. Read as red, that sent repair actors to fix work nobody had
 * judged, and withheld deliveries for it. It never counts against a
 * promise; it asks the person to reword the criterion into something that
 * can be settled.
 */
type ProofVerdict = "green" | "red" | "pending" | "unjudged";

/** Evidence on a delivery: probe runs, suite verdicts, CI verdicts. */
export interface Proof {
  kind: "probe" | "suite" | "ci" | "assessment" | "staged";
  label: string;
  verdict: ProofVerdict;
  /** For a "pending" verdict: where the answer will come from — the CI
   *  step, the cluster playbook, the person's attestation. Harvested
   *  after the merge; never counted as an unkept promise. */
  settledBy?: string;
  /** Where the machine face of this evidence lives (log, run URL). */
  ref?: string;
  /** The check this proof answers — the claim card reads verification
   *  state through this, not by matching label prose. */
  criterionId?: string;
}

/**
 * Is this proof a promise the run did not keep?
 *
 * Not green is not the same as not kept. A check that could not be RUN
 * judged nothing, and counting it against the work withheld deliveries for
 * the machine's own failures and sent repair actors after code that was
 * never assessed.
 */
export function unkeptProof(p: Proof): boolean {
  if (p.verdict === "pending" && p.settledBy) return false;
  if (machineMinted(p)) return false;
  return p.verdict !== "green" && p.verdict !== "unjudged";
}

/**
 * A promise the MACHINE minted, not one the person asked for.
 *
 * Grounding adds obligations of its own — bring the new modules under the
 * reachability gate, split the files this work pushed past the reading
 * limit. They are reasonable housekeeping and they are nobody's ask: they
 * serve no subject the person named, and they exist because the work
 * happened to touch something.
 *
 * They were given the standing of a signed promise, so one could withhold
 * a whole delivery. A run of a hundred and ninety proofs was held back on
 * three, and two of those traced to a gap the machine wrote for itself
 * while every criterion the person had actually asked for was green.
 *
 * So a gap informs and never vetoes. It rides the delivery as a finding,
 * where the person can read it and decide, which is what a machine's own
 * housekeeping is worth.
 */
export function machineMinted(p: { criterionId?: string }): boolean {
  return /-gap-\d/.test(p.criterionId ?? "");
}

/** An exam amended mid-run, on the record: the oracle's ruling on a
 *  coder's challenge to a check. Granted rulings ride the delivery's
 *  face — the human accepts knowing the exam changed, by whom and why. */
export interface Ruling {
  /** The check challenged, by criterion id. */
  criterionId: string;
  unit: string;
  granted: boolean;
  /** Why the probe misread the criterion — or why it stands. */
  reason: string;
}

export interface Delivery {
  /** What the machine could not settle with every actor spent — a suite
   *  opinion still red, a review nobody left could satisfy. Said by name
   *  for the person to weigh at Accept; never a reason to withhold kept
   *  promises. */
  findings?: string[];
  /** How big this tree's modules are — largest, median, average, and how
   *  much of it explains rather than instructs. Reported, never enforced: a
   *  ceiling on file length is satisfied by deleting the explanation, which
   *  is the cheaper move and the worse one. What the shape means is the
   *  person's to judge. */
  moduleSizes?: TreeShape;
  id: string;
  cutId: string;
  branch: string;
  /** The run that produced this delivery — the same id that heads that
   *  run's rows in the space's run log. Always minted by the gate; absent
   *  only on a record from before this field existed, which stays readable
   *  and is never read as the newest run's. */
  runId?: string;
  /** When that run produced this delivery (ISO timestamp), read from the
   *  same clock reading that minted `runId` — one moment names both. */
  producedAt?: string;
  proofs: Proof[];
  /** The delivery's home on the forge (pull request URL). */
  url?: string;
  /** Declared gaps from the run's workers — honest, never hidden. */
  undelivered?: string[];
  /** What only the person can certify, by using the delivered thing: the
   *  promises' unverified effects and every observation-shaped criterion,
   *  each with its reason. On the delivery's face — never a check, never a
   *  reason to withhold: the observation needs the delivery to exist. */
  observations?: string[];
  /** Challenges ruled on during the run — every one, granted or not. */
  rulings?: Ruling[];
  /** Contract-completing choices the tester made where the contract was
   *  silent — a name, a literal, a rule — flowed to the coder and kept here. */
  decisions?: { unit: string; text: string }[];
  /** Why this delivery was withheld (the suite red after the work): the
   *  work and its proofs are on the record, nothing was opened, and it
   *  cannot be accepted. */
  withheld?: string;
  /** The merge the hand-over made. Taking the work back out is reverting
   *  this one commit. */
  mergedHead?: string;
  /** Why the merge never reached the remote, when it did not. The work is
   *  in the project; the platform has not seen it. */
  notPushed?: string;
  /** Where the work is seen, once the platform has taken it live. */
  liveAt?: string;
  /** When the run merged this work into the project. On a development
   *  platform the work goes live before it is judged: what the person
   *  decides afterwards is whether to keep it or roll it back. */
  mergedAt?: string;
  /** Set when the human keeps it: the work stands, and nothing else moves. */
  acceptedAt?: string;
  /** When the person refused it. A refused delivery ends nothing: the work
   *  stays on its branch, the cut goes back to signed, and it can run
   *  again. Saying "no" is a decision the machine must be able to record —
   *  without it, the only way to reject was to leave the page and never
   *  come back. */
  rejectedAt?: string;
  /**
   * What happened to this work AFTER it was merged: the platform's own
   * build and test of the merged tree, or a person saying it was wrong.
   *
   * Accept was the end of the story. A delivery whose merged work then
   * broke the build stayed "accepted, every check green" for ever, the
   * branch was already gone, and the only one who could act was the
   * person, by hand, in an editor. What comes back lands here, the work
   * can be run again from it, and the page says so.
   */
  afterMerge?: {
    at: string;
    /** "held" — the platform built and deployed it; "broke" — it ran and
     *  judged the work wanting; "unjudged" — it could not run at all, and
     *  says nothing about the work. */
    outcome: "held" | "broke" | "unjudged";
    /** What said so: the platform's pipeline, or the person. */
    said: string;
    /** In its own words: the failing stage, the person's sentence. */
    detail?: string;
    /** How many times the run repaired and pushed again before giving the
     *  answer back to the person. Absent when it never tried. */
    tried?: number;
  };
}

/**
 * A criterion that does not hold, and who says so.
 *
 * The grain is the criterion, because that is what a proof is about: a
 * promise is unkept when one of its criteria is, and nothing coarser can
 * say which part of a delivery the world refused.
 */
export interface Contradiction {
  criterionId: string;
  at: string;
  /** Who says so: a person by name, or the machine that judged. */
  by: string;
  /** Where it came from — what decides how much it is worth. */
  source: "person" | "pipeline" | "validation" | "gate";
  /** In their own words: what was seen. A contradiction without words
   *  tells a repair nothing, so it is refused. */
  said: string;
  /** Machine face of the evidence: a pipeline step, a log excerpt. */
  ref?: string;
}

/** One project's working graph. */
/**
 * Something the machine could not settle from the code: a question with the
 * machine's recommendation. The human's accept turns it into a decision —
 * binding, recorded, and re-grounding whatever it affects.
 */
/**
 * Something the human's words did not decide. It is never a blocking ask:
 * the machine states what it assumed and which clause was silent, and the
 * assumption becomes a rule when the human commits to building. Silence is
 * consent, but only at the moment they press — never because time passed.
 */
export interface Question {
  id: string;
  askId: string;
  text: string;
  recommendation?: string;
  /** The part of the human's sentence that decided nothing, quoted. */
  clause?: string;
  /** The accepted wording; set only by the human's act. */
  decided?: { text: string; at: string };
}

/** A staged machine suggestion — visible, structurally inert until the
 *  human accepts or rejects. A rejected merge is a PERMANENT veto. */
interface MergeProposal {
  id: string;
  a: string;
  b: string;
}

/** A decision's staged implication: the ask whose changes the decision
 *  implies re-deriving. Nothing changes until the human accepts. */
interface ImpactSuggestionShape {
  id: string;
  questionId: string;
  askId: string;
  /** The decision's text, for the render. */
  decision: string;
}

export interface Space {
  asks: Ask[];
  nodes: Change[];
  units: Unit[];
  cuts: Cut[];
  deliveries: Delivery[];
  questions: Question[];
  /** Staged machine merge suggestions awaiting the human. */
  proposals?: MergeProposal[];
  /** Permanent merge vetoes (pair keys) — a rejected pair is never re-proposed. */
  vetoes?: string[];
  /** Units the human has already ruled on, keyed by the promises they hold:
   *  merging or keeping apart settles a unit until its promises change. */
  settled?: string[];
  /** Staged decision impacts awaiting the human. */
  impacts?: ImpactSuggestionShape[];
  /**
   * Evidence that a criterion once proved does NOT hold.
   *
   * A delivery's proofs are claims about the world, and the world can
   * answer back: a person using the delivered thing, the platform's own
   * build of the merged work, a component's validation, a later gate
   * re-running a standing check. Appended, never edited — the newest
   * evidence about a criterion is what counts, so a later delivery that
   * proves it green again needs nothing removed here.
   */
  contradictions?: Contradiction[];
  /** The model the capture round solved: what the asks are about. */
  subjects?: Subject[];
  /** What must become true of each subject. */
  claims?: Claim[];
  /** The sets worth delivering separately. Absent until the grouping is made;
   *  a space without them behaves exactly as it did before. */
  specs?: Spec[];
  /** The draft: what you are writing, before any of it is an ask.
   *  Kept with the space so you can close the window mid-sentence and
   *  find it where you left it. Nothing is derived from it and nothing
   *  costs anything until you read it. */
  draft?: string;
  /** A reading waiting for the human. Part of the record, so it survives a
   *  reload and a second paste cannot silently replace it. */
  proposal?: {
    askIds: string[];
    texts: string[];
    subjects: {
      name: string;
      from: number[];
      // `quote` and `mention` ride all the way through: the reading marks
      // your sentence with them, and the intent page marks it again after
      // the reading is kept. Dropped at any hop, the marks work while a
      // reading is pending and never afterwards.
      claims: { text: string; why?: string; from: number; quote?: string; mention?: string }[];
    }[];
    missing: number[];
  };
  /** A reading that failed, with the round's own words for why. */
  readingFailure?: { askIds: string[]; texts: string[]; reason: string };
}

/**
 * A SPEC is a set of subjects worth building and showing on its own.
 *
 * The unit of DELIVERY, and the level v2 lost. v1 dispatched per spec —
 * `dispatchGuard.ts` still says so: "invocations for different Specs run
 * unimpeded" — and v2 collapsed it into the cut, so everything signed became
 * one dispatch, one gate, one delivery. Nineteen asks about a surface then had
 * nowhere to become five things, and the correction that turns a tricycle into
 * a car happens between deliveries.
 *
 * Chosen from the subjects on the first screen, before any grounding: the
 * cheapest point in the system to decide it, and the one that decides whether
 * work arrives in one piece or five. A subject belongs to exactly one spec —
 * in two, it is built twice and the second delivery rebuilds the first.
 */
export interface Spec {
  id: string;
  /** What becomes true when it is delivered, in the person's register. */
  name: string;
  subjectIds: string[];
}

/**
 * A SUBJECT is the thing the work is about — the human's noun, taken from
 * their own sentence. Claims hang off it; nothing else does.
 */
export interface Subject {
  id: string;
  /** The human's name for it. */
  name: string;
  /** Ask ids that named or described it — its provenance. */
  from: string[];
}

/**
 * A CLAIM is what must become true of one subject, in the human's words,
 * carrying the purpose they gave it and citing the sentence it came from.
 */
export interface Claim {
  id: string;
  subjectId: string;
  /** What must become true. */
  text: string;
  /** The "so that…" — why it must, in the human's words. */
  why?: string;
  /** The ask this claim was read from; its words are never replaced. */
  fromAsk: string;
  /** The words of that ask this claim was read from, exactly as written —
   *  what lets the sentence be shown back with the claim marked inside it. */
  quote?: string;
  /** The words in that ask that stand for the subject: the writer's own
   *  wording for it there, or a pronoun. One subject is often written
   *  differently in every sentence — "finished tasks", "the high priority
   *  ones" — and its name can only be one of them, so without this the page
   *  can point at the subject in one sentence and nowhere else. */
  mention?: string;
}

export function emptySpace(): Space {
  return { asks: [], nodes: [], units: [], cuts: [], deliveries: [], questions: [] };
}
