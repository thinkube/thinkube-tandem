/**
 * Pure section-replace for Spec / TEP markdown bodies.
 *
 * The `patch_spec_section` MCP tool needs to rewrite exactly one named section
 * of a spec body and leave every other byte untouched, then hand the whole new
 * body to the secret-scanning safe-write path (`ThinkubeStore.writeFile`). This
 * module is the pure core of that tool: no I/O, no store, no `vscode` — just
 * `body × section × content → body`, so it is trivially testable and the tool
 * registration only has to do the read → {@link sectionPatch} → write dance.
 *
 * It replaces the model's old habit of reading a spec, hand-merging a section,
 * and writing the *whole* body back — a pattern that routinely clobbered
 * unrelated sections.
 *
 * A "section" is a markdown heading (`#`..`######`) plus everything beneath it
 * up to (but not including) the next heading at the **same or shallower** level.
 * Deeper `###` subsections under a `##` section are therefore part of that
 * section's content, mirroring the boundary rule used elsewhere in this repo
 * (see `specChange.normalizeRequirementSections`).
 *
 * Guarantee: the text before the matched heading and the text from the next
 * sibling/parent heading onward are returned **byte-identical**. Only the
 * matched section's heading line (preserved verbatim) and its body (replaced
 * with `content`) change.
 */

/** Normalize a heading title for matching: drop emphasis chars, trim, lowercase. */
function normalizeTitle(title: string): string {
  return title.replace(/[*_`]/g, "").trim().toLowerCase();
}

interface HeadingLine {
  /** Index into the line array. */
  index: number;
  /** Heading depth (number of leading `#`). */
  level: number;
  /** Normalized title for matching. */
  title: string;
}

/**
 * Split a body into physical lines, each element keeping its trailing `\n`
 * (and `\r` if present), so that re-joining is byte-exact. The final line may
 * lack a trailing newline.
 */
function splitKeepingNewlines(body: string): string[] {
  if (body === "") return [""];
  return body.split(/(?<=\n)/);
}

/** Parse a physical line (newline included) as a markdown heading, if it is one. */
function parseHeading(line: string, index: number): HeadingLine | null {
  const text = line.replace(/\r?\n$/, "");
  const m = text.match(/^(#{1,6})\s+(.*?)\s*$/);
  if (!m) return null;
  return { index, level: m[1].length, title: normalizeTitle(m[2]) };
}

export class SectionNotFoundError extends Error {
  constructor(public readonly section: string) {
    super(`section "${section}" not found in body`);
    this.name = "SectionNotFoundError";
  }
}

export class AmbiguousSectionError extends Error {
  constructor(
    public readonly section: string,
    public readonly count: number,
  ) {
    super(
      `section "${section}" matches ${count} headings; refusing to patch ambiguously`,
    );
    this.name = "AmbiguousSectionError";
  }
}

/**
 * Replace exactly the one section named `section` in `body` with `content`,
 * returning the new body. The heading line is preserved verbatim; everything
 * outside the section is byte-identical to the input.
 *
 * `content` is the section's *body* (the heading is not part of it). It is
 * inserted as `<heading>\n\n<content>\n` (with a trailing blank line before the
 * next section when one follows), regardless of how it was passed, so callers
 * needn't manage the surrounding blank lines. Leading/trailing blank lines in
 * `content` are trimmed; interior content is preserved verbatim.
 *
 * Matching is by heading title, compared case-insensitively after stripping
 * markdown emphasis (`*`/`_`/`` ` ``). Throws {@link SectionNotFoundError} if no
 * heading matches and {@link AmbiguousSectionError} if more than one does — the
 * tool surfaces these rather than silently patching the wrong section.
 */
export function sectionPatch(
  body: string,
  section: string,
  content: string,
): string {
  const wanted = normalizeTitle(section);
  if (!wanted) throw new SectionNotFoundError(section);

  const lines = splitKeepingNewlines(body);

  const headings: HeadingLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeading(lines[i], i);
    if (h) headings.push(h);
  }

  const matches = headings.filter((h) => h.title === wanted);
  if (matches.length === 0) throw new SectionNotFoundError(section);
  if (matches.length > 1)
    throw new AmbiguousSectionError(section, matches.length);

  const heading = matches[0];

  // End of the section: the next heading at the same or shallower level.
  let endIndex = lines.length;
  for (const h of headings) {
    if (h.index > heading.index && h.level <= heading.level) {
      endIndex = h.index;
      break;
    }
  }

  const prefix = lines.slice(0, heading.index).join("");
  const headingLine = lines[heading.index].replace(/\r?\n$/, "");
  const suffix = lines.slice(endIndex).join("");

  const trimmedContent = content.replace(/^\s*\n/, "").replace(/\s+$/, "");

  let rebuilt = `${prefix}${headingLine}\n`;
  rebuilt += trimmedContent ? `\n${trimmedContent}\n` : "\n";
  if (suffix) rebuilt += `\n${suffix}`;

  return rebuilt;
}
