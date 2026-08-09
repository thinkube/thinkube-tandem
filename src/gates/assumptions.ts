/**
 * What reaches the human, and in whose words.
 *
 * A round that has just finished deriving is holding the repository, its
 * own numbered changes and its own internal nouns, and it writes to a
 * reader who shares all of it. The human shares none of it. An instruction
 * in a prompt does not fix that — the round satisfies it in its own head —
 * so the check is mechanical and runs on the text that comes back.
 *
 * Two gates, in order:
 *  - VOCABULARY: an assumption may not speak the machine's private
 *    language. Two closed tests, neither of which needs a dictionary of
 *    English: anything shaped like an identifier (a path, a dotted name,
 *    camelCase, an ordinal like "8.0"), and the system's own invented
 *    nouns — words that exist because of how it is built, not because of
 *    anything the human asked for.
 *  - ANSWERED: what a rule in force already settles is not asked again.
 *
 * A refused question is never discarded. It keeps its recommendation,
 * which becomes the assumption the machine states; only its right to be
 * presented as the human's decision is withdrawn.
 */

/**
 * The machine's own nouns. This list is closed and knowable because these
 * words exist only inside this system: every one of them names a part of
 * how the thinking is built, not a part of what anyone asked for. A word
 * the human writes themselves is theirs from then on, and is allowed.
 */
const MACHINE_NOUNS = [
  "grounding",
  "derivation",
  "derive",
  "derived",
  "touchpoint",
  "touchpoints",
  "anchor",
  "anchors",
  "stamp",
  "digest",
  "node",
  "nodes",
  "unit",
  "units",
  "slice",
  "slices",
  "dispatch",
  "preflight",
  "worktree",
  "worktrees",
  "sidecar",
  "roster",
  "autosync",
  "fold",
  "snapshot",
  "criterion",
  "criteria",
  "ordinal",
  "prompt",
  "round",
  "rounds",
  "pipeline",
  "parse",
  "parsed",
  "schema",
  "affordance",
  "affordances",
  "registry",
  "webview",
  "bundle",
  "runtime",
  "callback",
  "handler",
  "boolean",
  "config",
  "flag",
  "branch",
  "commit",
  "repo",
  "hash",
  "footprint",
  "probe",
  "probes",
  "oracle",
  "frontier",
  "porcelain",
  "consumes",
  "waiver",
  "escalation",
];

export interface Raised {
  text: string;
  recommendation?: string;
}

export interface Judged extends Raised {
  /** Why it will not be put to the human as a choice, when it will not. */
  refused?: "answered" | "foreign";
  /** The machine's own words, kept so the log can name them. */
  foreign?: string[];
}

const contentWords = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z][a-z']{2,}/g) ?? []);

/** Anything shaped like something only a machine writes. */
function looksLikeIdentifier(token: string): boolean {
  return (
    /[/\\]/.test(token) ||
    /[A-Za-z]\.[A-Za-z]/.test(token) ||
    /[a-z][A-Z]/.test(token) ||
    /_/.test(token) ||
    /\d/.test(token)
  );
}

/**
 * The machine's own language inside `text`, minus anything the human has
 * written themselves — their words are theirs, whatever they are.
 */
export function foreignWords(text: string, humanText: string[]): string[] {
  const theirs = new Set(contentWords(humanText.join(" ")));
  const out = new Set<string>();
  for (const token of text.split(/\s+/)) {
    const bare = token.replace(/^[^A-Za-z0-9_./\\-]+|[^A-Za-z0-9_./\\-]+$/g, "");
    if (!bare) continue;
    if (looksLikeIdentifier(bare)) {
      if (!theirs.has(bare.toLowerCase())) out.add(bare);
      continue;
    }
    const w = bare.toLowerCase();
    if (MACHINE_NOUNS.includes(w) && !theirs.has(w)) out.add(bare);
  }
  return [...out];
}

/** Judge what a round wants to ask, against the human's own world. */
export function judgeRaised(
  raised: Raised[],
  human: { asks: string[]; claims: string[]; rules: string[] },
): Judged[] {
  const theirs = [...human.asks, ...human.claims, ...human.rules];
  const settled = new Set(contentWords(human.rules.join(" ")));
  return raised.map((q) => {
    const foreign = foreignWords(`${q.text} ${q.recommendation ?? ""}`, theirs);
    if (foreign.length) return { ...q, refused: "foreign", foreign };
    // A rule that already covers the question's own content words has
    // settled it, and putting it again is asking the same thing twice.
    const asked = [...new Set(contentWords(q.text))];
    const covered = asked.filter((w) => settled.has(w)).length;
    if (asked.length >= 4 && covered / asked.length > 0.8) return { ...q, refused: "answered" };
    return q;
  });
}
