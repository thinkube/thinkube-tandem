/**
 * How these surfaces are set: type, space and colour, in one place.
 *
 * A drawing is elegant because one hand made every decision in one
 * sitting; a program grows patch by patch, and each patch invents a value
 * near the last one. These four surfaces had nine opacities, twelve
 * paddings and twelve hand-written colours between them — nothing wrong
 * anywhere, and the near-misses everywhere are what the eye reads as
 * muddy. Everything below is a small closed set. Reach for a value here
 * before writing a number in a style, and the surfaces stay one thing.
 *
 * Two readers are served by one rule: THE WORD CARRIES THE MEANING.
 * Colour never says anything a label does not already say, which is what
 * a reader who cannot separate red from green needs. Sentences are set as
 * written and nothing that carries meaning is italic, which is what a
 * reader with dyslexia needs. Capitals are for captions only — a caption
 * is a landmark before it is a word, which is what a caption is for and
 * what a sentence must never be.
 */

/**
 * The spacing scale. Every margin, padding and gap comes from here, so
 * the rhythm of the page is one rhythm.
 */
export const SP = { xs: 3, sm: 6, md: 10, lg: 16, xl: 24 } as const;

/** The type scale. Four sizes: a caption, the text, a title, a heading. */
export const FS = { caption: 11, body: 13, title: 14, heading: 16 } as const;

/** The corner of everything that has one. */
const R = { sm: 4, md: 6 } as const;

/**
 * Colour by the job it does, never by its name. Each maps to the theme
 * the reader chose, so these surfaces belong to the editor around them.
 */
export const C = {
  /** Behind a card or a panel that sits above the page. */
  raised: "var(--vscode-editorWidget-background, #252526)",
  /** The line around anything raised. */
  border: "var(--vscode-panel-border, #3c3c3c)",
  /** A second line of text: present, not shouting. */
  quiet: "var(--vscode-descriptionForeground, #9d9d9d)",
  /** The reader's attention is here. */
  focus: "var(--vscode-focusBorder, #3794ff)",
  /** Proved. */
  ok: "#4ec9b0",
  /** Not proved. */
  bad: "#f14c4c",
  /** Waiting on a person. */
  ask: "#e5c07b",
  /** Committed — the one gold thing on these surfaces. */
  gold: "#cca700",
  /** Being worked on right now. */
  live: "#3794ff",
} as const;

/**
 * How quiet a thing is. Two levels: a second voice, and decoration. Nine
 * shades of grey are nine decisions nobody made on purpose.
 */
export const O = { dim: 0.75, faint: 0.5 } as const;

/**
 * A caption naming what follows: "SUBJECT", "CHECKS", "DELIVERED".
 *
 * Capitals, and everything else that separates a caption from the text
 * under it: weight, its own colour, wide letters and space above. A
 * caption is a landmark, so all four cues pull the same way and the eye
 * lands on it without reading the page to find it.
 */
export const label: React.CSSProperties = {
  fontSize: FS.caption,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.quiet,
  marginTop: SP.sm,
  marginBottom: SP.xs,
};

/** The same caption in a colour of its own — still a word first. */
export const labelIn = (color: string): React.CSSProperties => ({ ...label, color });

/** A second line under a claim or promise: quieter, never italic. */
export const aside: React.CSSProperties = {
  fontSize: FS.caption,
  color: C.quiet,
};

/** Anything raised off the page: a card, a panel, a report. */
export const raised: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: R.md,
  background: C.raised,
};

/**
 * What a worker is, as a word and a colour: the band across the top of
 * its card. Blue, amber and teal stay apart from each other under every
 * common form of colour blindness — and each still says what it is.
 */
export const ROLES = {
  test: {
    text: "Tests first",
    color: C.ok,
    why: "This worker writes the checks before anything is built, and never sees the code.",
  },
  code: {
    text: "Code",
    color: C.live,
    why: "This worker writes the code. It never sees the checks that will judge it.",
  },
  audit: {
    text: "Audit",
    color: C.ask,
    why: "This worker grades the checks against the real state — it writes nothing.",
  },
} as const;
