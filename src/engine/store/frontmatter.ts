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
