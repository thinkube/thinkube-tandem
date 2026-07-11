/**
 * YAML frontmatter parse/serialize for `.thinkube/*.md` files.
 *
 * Round-trip discipline: parsing a file and re-serializing the same
 * `{ frontmatter, body }` produces a byte-equivalent file up to the YAML
 * block's own whitespace (the `yaml` library normalizes spacing). Callers
 * relying on exact equality should round-trip through this module rather
 * than building strings by hand.
 *
 * Files without a leading `---` block are still valid — `parseFrontmatter`
 * returns `frontmatter: undefined` and the whole text as `body`. This lets
 * the store be used for free-form notes (retros, ADRs) before any
 * frontmatter is added.
 *
 * Frontmatter shape is defined by §Appendix B of the integration plan and
 * mirrored as `Frontmatter` here. Unknown keys are preserved verbatim — we
 * never strip fields we don't recognize.
 */
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export type Kind =
  | "spec"
  | "slice"
  | "tep"
  | "decision"
  | "retro"
  // legacy GitHub-backed kinds — removed once their consumers go (migration phases 5–7)
  | "epic"
  | "story"
  | "task-decomposition";

export interface Frontmatter {
  kind?: Kind;
  // ── Tandem (files-first Spec→Slice) ──
  /** Stable internal id for a slice — the thinking space links on this; never changes. */
  uid?: string;
  /** Parent Spec handle for a slice, e.g. "SP-3". Supersedes `parent_issue`. */
  parent?: string;
  /** Free-form clustering tags — the #hashtag mesh:
   *  component (`keycloak`), concern (`security`), project (`rebrand`). Many-to-many
   *  and cross-thinking space. Read via `effectiveTags` (which also folds the legacy `theme`). */
  tags?: string[];
  /** @deprecated Superseded by `tags`; still read via `effectiveTags`.
   *  Legacy single grouping tag (sat above the Spec; not a tier). */
  theme?: string;
  /** Thinking Space column / lifecycle status. Slices use ready|doing|done|archived;
   *  TEPs use proposed|accepted|superseded|implemented (TEP-0009; `implemented`
 * is the terminal "delivered" status per , distinct from `accepted`
   *  = approved-to-build); draft|active are legacy. */
  status?:
    | "ready"
    | "doing"
    | "done"
    | "requires-attention"
    | "archived"
    | "draft"
    | "active"
    | "proposed"
    | "accepted"
    | "superseded"
    | "implemented";
  /** Optional slice due date (yyyy-mm-dd). */
  due?: string;
  /** Optional slice priority. */
  priority?: "P0" | "P1" | "P2" | "P3";
  /** Spec requirement-hash a slice was last verified against (set at the → Done gate). */
  verified_req_hash?: string;
  /** Full commit SHA the slice was built on, captured when it enters Done. */
  commit?: string;
  /** Pull-request URL carrying the slice, captured when it enters Done. */
  pr?: string;
  /** Optional slice dependency handles, e.g. ["SP-3_SL-7"]. */
  depends_on?: string[];
  /** Named concurrency group: sibling slices sharing this value may run in
   *  parallel worktrees, so their `files` sets MUST be disjoint
 * (`validateParallelGroup`). Absent → the slice runs sequentially. */
  parallel_group?: string;
  /** The teammate / worktree currently owning this slice; empty until claimed
   *  by the ownership arbiter. */
  assignee?: string;
  /** Machine-readable file set the slice declares it will edit — the unit of
   *  disjointness for a `parallel_group` and the ownership arbiter's claim.
   *  Repo-relative paths. */
  files?: string[];
  /** Footprint paths this slice CREATES (new files). Exempt from the
   *  create/update existence gate; every other footprint path must already
   *  exist in the working repo. */
  creates?: string[];
  /** 1-based AC ordinals this slice delivers; the → Done gate checks each is ticked on the parent Spec. */
  satisfies?: number[];
  /** The slice's design-time CONTRACT (SP-6/3): the shared interface — exact exports, types,
   *  signatures, behaviour — every unit (code AND held-out test) builds against. Authored by the
   *  slicer when the slice is created and injected verbatim into every worker prompt, so units
   *  agree on the seam without consuming each other. A slice that declares a contract is exempt
   *  from the contract-first gate (the contract IS the shared seam), and needs `consumes` only for
   *  a genuine produced-artifact dependency. */
  contract?: string;
  /** Spec-level: the closing gate's per-AC verification declaration —
   *  a map AC-ordinal → how that AC is verified. The orchestrator runs the union as a full plan
   *  at Spec quiescence and gates Done/commit on all-green (no skip; red or un-runnable →
   *  requires-attention). `run` is a shell/playbook command (exit 0 = the AC's verification
   *  passed); `env` is informational — `cluster` for an infra lifecycle, `local` otherwise.
   *  Keys are the 1-based AC ordinals (as YAML map keys, parsed tolerantly).
   *  `env: "assessment"` (SP-6/7 AC3) marks an AC graded by an independent assessor session
   *  rather than a runnable command — a prose/UX/skill AC that no shell probe fits; the closing
   *  gate dispatches a fresh assessor (never the implementing worker) that returns pass/fail +
   *  rationale from the AC + intent + delivered artifact, so `run` is unused for it. */
  ac_verifications?: Record<
    string,
    { run?: string; env?: "cluster" | "local" | "assessment" }
  >;
  /** Execution-aware work units under this slice: each an atom with a
   *  file/object footprint + an execution shape. The slice stays the validation
   *  envelope — work units are never independently gated. */
  work_units?: {
    /** Repo-relative files/objects this unit touches — the parallelism footprint. */
    footprint: string[];
    /** Work-unit/slice handles this unit depends on (ordering). */
    depends_on?: string[];
    /** Contract-first reference: repo-relative files a *sibling* unit
     *  produces that this unit reads. `buildUnitDag` resolves each entry to a
     *  dependency edge on the sibling whose footprint produces it — the typed,
     *  validated alternative to pinning the contract in `note`. */
    consumes?: string[];
    /** Repo-relative files this unit reads but does **not** itself produce
     *  (SP-6/2). Declared (not inferred), so the authoring-time `undeclaredReads`
     *  gate can compare them against sibling productions: any `reads` entry that
     *  lands on another unit's footprint with no matching `consumes` edge is an
     *  undeclared cross-unit dependency and the slice is refused, naming the file
     *  and its producer. Runs at the door, beside the consumes-resolvability gate. */
    reads?: string[];
    /** serial (coupled) | mechanize (uniform data-parallel: one transform applied
     *  N times) | fan-out (heterogeneous: AI per object). */
    execution: "serial" | "mechanize" | "fan-out";
    /** Independent-verification role (SP-6/7 AC1). A `code` unit (the default) sees the Spec's
     *  INTENT only — the `## Acceptance Criteria` block + `satisfies` are stripped from its prompt;
     *  a `test` unit is the held-out verifier: it KEEPS the ACs in its prompt and its footprint is
     *  the reserved `acceptance/` probe path, so the grade it authors is independent of the code.
     *  Absent ⇒ `code` (backward-compatible; existing slices are unaffected). */
    role?: "code" | "test";
    /** The unit's task text — what this unit does. Self-describing so a worker can
     *  act on it without re-reading siblings; required in practice for `fan-out`. */
    note?: string;
  }[];
  /** Documentation obligation. `required` (default for user-facing
   *  work) arms the → Done docs gate; `n/a` skips it but must carry `docs_reason`. */
  docs?: "required" | "n/a";
  /** One-line justification, required when `docs: n/a` — so skipping docs is a
   *  visible, deliberate choice, never silent. */
  docs_reason?: string;
  /** Set true when a `docs: required` slice's documentation has been updated;
   *  the → Done docs gate checks this — like a verifier-green stamp. */
  docs_done?: boolean;
  /** ISO date the file was created. */
  created?: string;
  /** Spec-level: ISO timestamp the human accepted the Spec (set by `accept_spec`, TEP-0010). */
  accepted?: string;
  /** Spec-level: ISO timestamp the Spec was superseded (set by `supersede_spec`,
   *  SP-6/14). Its PRESENCE (a non-empty string) means the Spec is superseded — a
   *  deliberate "not building this" state, orthogonal to `accepted:` and to the
   *  view-only `archived:` flag. Unlike `archived`, a superseded Spec is removed
   *  from `tepComplete`'s `openSpecs`/completeness. Cleared by `unsupersede_spec`.
   *  Mirrors the shape of `accepted:` (a dedicated spec-level fact, not a `status:`). */
  superseded?: string;
  /** Spec-level: the human reason recorded when a Spec is superseded
   *  (set alongside `superseded` by `supersede_spec`, SP-6/14). Cleared by
   *  `unsupersede_spec`. */
  superseded_reason?: string;
  /** Spec/TEP-level: hidden from the nav by default when true; a manual, reversible
   *  flag. Distinct from a slice's `status: archived` thinking space column. */
  archived?: boolean;
  /** Spec-level: the TEP this Spec implements, e.g. `TEP-0009` (TEP-0009 link). */
  implements?: string;
 /** TEP-level: the Specs that deliver this TEP, e.g. `["SP-4"]`. */
  implemented_by?: string[];
  /** `owner/name`; the repo this thinking space belongs to. */
  repo?: string;
  // ── legacy GitHub-backed model (removed once consumers go, phases 5–7) ──
  /** @deprecated GitHub issue this file extends. */
  issue?: number;
  /** @deprecated Parent issue in the hierarchy. */
  parent_issue?: number;
  /** Anything else the user puts in the frontmatter. We preserve unknown keys. */
  [extra: string]: unknown;
}

/**
 * The effective tag set for an item: `tags` unioned
 * with a legacy single `theme` (superseded but never dropped). Explicit `tags`
 * come first, then `theme` if not already present; blanks trimmed, deduped.
 */
export function effectiveTags(fm: Frontmatter | undefined): string[] {
  if (!fm) return [];
  const out: string[] = [];
  const push = (t: unknown) => {
    if (typeof t !== "string") return;
    const v = t.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  if (Array.isArray(fm.tags)) fm.tags.forEach(push);
  push(fm.theme);
  return out;
}

export interface ParsedFile {
  /** Parsed frontmatter, or undefined if the file has no `---` block. */
  frontmatter: Frontmatter | undefined;
  /** Body content (everything after the closing `---`, leading newline trimmed). */
  body: string;
  /** Original raw text — kept so callers can detect changes without reparsing. */
  raw: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text: string): ParsedFile {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return { frontmatter: undefined, body: text, raw: text };
  }
  const yamlBlock = match[1];
  const rest = text.slice(match[0].length);
  let fm: Frontmatter | undefined;
  try {
    const parsed = yamlParse(yamlBlock);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fm = parsed as Frontmatter;
    } else {
      fm = undefined;
    }
  } catch {
    // Malformed YAML — treat as no frontmatter rather than failing the
    // whole read. The body still loads; callers can detect this via
    // frontmatter === undefined and surface a warning if they care.
    fm = undefined;
  }
  return { frontmatter: fm, body: rest, raw: text };
}

export function serializeFrontmatter(input: {
  frontmatter: Frontmatter | undefined;
  body: string;
}): string {
  const body = input.body ?? "";
  if (!input.frontmatter) {
    return body;
  }
  const yamlBlock = yamlStringify(input.frontmatter, {
    // Stable key order across writes; trips up fewer git diffs.
    sortMapEntries: false,
    lineWidth: 0,
  }).trimEnd();
  const sep = body.startsWith("\n") ? "" : "\n";
  return `---\n${yamlBlock}\n---${sep}${body}`;
}

/**
 * Secret scan applied before `writeFile` commits a body to disk. Conservative
 * by design — false positives are annoying but acceptable; false negatives
 * are bad. Returns the matched pattern name(s) for each hit so callers can
 * tell the user what was found.
 */
export interface SecretMatch {
  pattern: string;
  /** Position in the input where the match begins. */
  index: number;
  /** The matched substring, truncated to first 8 chars for safe display. */
  preview: string;
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "github-pat-classic", regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  {
    name: "github-pat-fine-grained",
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  { name: "github-oauth", regex: /\bgho_[A-Za-z0-9]{36}\b/g },
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  // 40 base64 chars at end of line. The negative lookahead skips pure
  // lowercase-hex 40-runs: those are digests/SHAs (e.g. our own 40-char
  // `verified_req_hash` stamp, or git object ids), not AWS secret keys — which
  // use the full mixed-case base64 alphabet and are ~never all-lowercase-hex.
  // Without this, stamping a slice's requirement-hash on move-to-Done tripped
  // this very scanner on the server's own write.
  {
    name: "aws-secret-key",
    regex: /\b(?![0-9a-f]{40}\b)[a-zA-Z0-9/+=]{40}\b(?=\s*[\n,])/g,
  },
  { name: "openai-key", regex: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: "slack-token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    name: "private-key-block",
    regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/g,
  },
];

export function scanForSecrets(text: string): SecretMatch[] {
  const hits: SecretMatch[] = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      hits.push({
        pattern: name,
        index: m.index,
        preview: m[0].slice(0, 8) + (m[0].length > 8 ? "…" : ""),
      });
      // Avoid pathological loops on zero-width matches (none of ours
      // are zero-width, but defensive).
      if (m.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return hits;
}
