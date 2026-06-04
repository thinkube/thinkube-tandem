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
  | "decision"
  | "retro"
  // legacy GitHub-backed kinds — removed once their consumers go (migration phases 5–7)
  | "epic"
  | "story"
  | "task-decomposition";

export interface Frontmatter {
  kind?: Kind;
  // ── Tandem (files-first Spec→Slice) ──
  /** Stable internal id for a slice — the board links on this; never changes. */
  uid?: string;
  /** Parent Spec handle for a slice, e.g. "SP-3". Supersedes `parent_issue`. */
  parent?: string;
  /** Theme grouping tag (sits above the Spec; not a tier). */
  theme?: string;
  /** Board column / lifecycle status. */
  status?: "ready" | "doing" | "done" | "archived" | "draft" | "active";
  /** Optional slice due date (yyyy-mm-dd). */
  due?: string;
  /** Optional slice priority. */
  priority?: "P0" | "P1" | "P2" | "P3";
  /** Spec requirement-hash a slice was last verified against (set by /pair-next). */
  verified_req_hash?: string;
  /** Optional slice dependency handles, e.g. ["SP-3_SL-7"]. */
  depends_on?: string[];
  /** ISO date the file was created. */
  created?: string;
  /** `owner/name`; the repo this board belongs to. */
  repo?: string;
  // ── legacy GitHub-backed model (removed once consumers go, phases 5–7) ──
  /** @deprecated GitHub issue this file extends. */
  issue?: number;
  /** @deprecated Parent issue in the hierarchy. */
  parent_issue?: number;
  /** Anything else the user puts in the frontmatter. We preserve unknown keys. */
  [extra: string]: unknown;
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
  { name: "aws-secret-key", regex: /\b[a-zA-Z0-9/+=]{40}\b(?=\s*[\n,])/g },
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
