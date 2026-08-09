/**
 * How text is set on these surfaces, in one place.
 *
 * Two readers are served by the same rule, so there is only one rule to
 * keep: THE WORD CARRIES THE MEANING. Colour never says anything a label
 * does not already say, which is what a reader who cannot separate red
 * from green needs; and the label itself is set to be read at a glance
 * rather than decoded, which is what a reader with dyslexia needs.
 *
 * In practice that means no capitals for whole words — uppercase strips
 * the ascenders and descenders a word is recognised by, so a caption in
 * capitals is read letter by letter — no italics for anything that
 * carries meaning, and captions kept at a size and contrast that can be
 * read, not merely detected.
 */

/** A caption naming what follows: "Subject", "Checks", "Delivered". */
export const label: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.01em",
  opacity: 0.8,
};

/** The same caption in a colour of its own — still a word first. */
export const labelIn = (color: string): React.CSSProperties => ({ ...label, color, opacity: 1 });

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
