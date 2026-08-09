/**
 * How text is set on these surfaces, in one place.
 *
 * Two readers are served by the same rule, so there is only one rule to
 * keep: THE WORD CARRIES THE MEANING. Colour never says anything a label
 * does not already say, which is what a reader who cannot separate red
 * from green needs; and the label itself is set to be read at a glance
 * rather than decoded, which is what a reader with dyslexia needs.
 *
 * In practice that means no italics for anything that carries meaning,
 * and captions kept at a size and contrast that can be read, not merely
 * detected. Sentences and labels a reader must take in are set as
 * written; capitals are for captions only — a caption is found before it
 * is read, and a word set in capitals is a landmark first and a word
 * second, which is what a caption is for and what a sentence must never
 * be.
 */

/**
 * A caption naming what follows: "SUBJECT", "CHECKS", "DELIVERED".
 *
 * Capitals, and everything else that separates a caption from the text
 * under it: weight, its own colour, wide letters and space above. A
 * caption is a landmark, so all four cues pull the same way and the eye
 * lands on it without reading the page to find it.
 */
export const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--vscode-descriptionForeground, #9d9d9d)",
  marginTop: 8,
  marginBottom: 3,
};

/** The same caption in a colour of its own — still a word first. */
export const labelIn = (color: string): React.CSSProperties => ({ ...label, color });

/** A second line under a claim or promise: quieter, never italic. */
export const aside: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.75,
};

/**
 * What a worker is, as a word and a colour: the band across the top of
 * its card. Blue, amber and teal stay apart from each other under every
 * common form of colour blindness — and each still says what it is.
 */
export const ROLES = {
  test: {
    text: "Tests first",
    color: "#4ec9b0",
    why: "This worker writes the checks before anything is built, and never sees the code.",
  },
  code: {
    text: "Code",
    color: "#3794ff",
    why: "This worker writes the code. It never sees the checks that will judge it.",
  },
  audit: {
    text: "Audit",
    color: "#e5c07b",
    why: "This worker grades the checks against the real state — it writes nothing.",
  },
} as const;
