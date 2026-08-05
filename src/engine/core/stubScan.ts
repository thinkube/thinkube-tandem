import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { loadTemplate } from "../promptTemplates";
import { clip } from "./guidance";
// ── Stub scan (the go-set, deterministic half — context tranche 2026-07-14) ─────
//
// A worker that stubs an obligation and confesses only in a code comment leaves no
// artifact the delivery report surfaces. This deterministic scan greps the delivered
// files for self-declared deferral markers at delivery-report time; hits render as
// "## Self-declared deferrals found in the delivered code". It complements (never
// replaces) the declared UNDELIVERED channel: one is the worker's honesty, this is
// the transcript-independent floor under it.

/**
 * Confession markers — unambiguous self-declared deferrals, case-insensitive,
 * whole-word. A hit on these is a deferral wherever it appears.
 */
export const STUB_CONFESSION_RE =
  /\b(TODO|FIXME|XXX|HACK|UNDELIVERED|not in scope|not implemented|unimplemented|pending SDK)\b/i;

/**
 * Weak markers — words that are design/API vocabulary as often as confession
 * ("no-op" describing documented semantics, "stub" naming a test double,
 * "placeholder" as UI hint text). Flagged, but classified `weak:true` so
 * consumers keep them OUT of the deferrals headline / defect ledger and render
 * them as review-by-eye items (precision fix, 2026-07-16: 11/11 delivery-report
 * "deferrals" were this class — probe doubles, HTML/VS Code `placeholder`
 * attributes, and documented no-op semantics — with zero real deferrals).
 */
export const STUB_WEAK_RE = /\b(stub|stubbed|no-op|noop|placeholder)\b/i;

/**
 * Key-position `placeholder` — the HTML attribute (`placeholder="…"`) and the
 * VS Code InputBox option (`placeHolder: "…"`). API vocabulary, never a
 * confession; stripped from a line before the weak-marker test. A deferral
 * VALUE like `itemId: "PLACEHOLDER"` is not key-position and still matches.
 */
const PLACEHOLDER_API_RE = /\bplaceholder\s*[=:]/gi;

/** Code-file extensions the stub scan reads — markers in prose/docs are not deferrals. */
const CODE_FILE_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|h|cc|cpp|hpp|cs|rb|php|swift|sh|bash|zsh|ps1|sql|vue|svelte)$/i;

/**
 * Probe/test files — stubs and no-op doubles there are SANCTIONED harness
 * machinery, not deferrals of delivered behavior (the acceptance directory,
 * plus .test./.spec./.host. suffixed files anywhere).
 */
const PROBE_FILE_RE =
  /(^|\/)src\/acceptance\/|\.(test|spec|host)\.[a-z]+$/i;

/** True when `file` (a repo-relative path) is a code file the stub scan should read. */
export function isStubScannableFile(file: string): boolean {
  return CODE_FILE_RE.test(file) && !PROBE_FILE_RE.test(file);
}

export interface StubScanHit {
  /** Repo-relative path of the delivered file. */
  file: string;
  /** 1-based line number of the hit. */
  line: number;
  /** The hit line's text, clipped. */
  text: string;
  /** True when only a weak marker matched — review-by-eye, not a deferral claim. */
  weak: boolean;
}

/** Scan ONE delivered code file's content for self-declared deferral markers.
 *  A {@link STUB_CONFESSION_RE} match is a deferral hit (`weak:false`); otherwise a
 *  {@link STUB_WEAK_RE} match (with key-position API `placeholder` stripped first)
 *  is a `weak:true` hit. One hit per matching line, text clipped to 160 chars.
 *  Pure — the caller reads the file (and filters via {@link isStubScannableFile}). */
export function scanStubMarkers(file: string, content: string): StubScanHit[] {
  const hits: StubScanHit[] = [];
  const lines = (content ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (STUB_CONFESSION_RE.test(line)) {
      hits.push({ file, line: i + 1, text: clip(line.trim(), 160), weak: false });
    } else if (STUB_WEAK_RE.test(line.replace(PLACEHOLDER_API_RE, ""))) {
      hits.push({ file, line: i + 1, text: clip(line.trim(), 160), weak: true });
    }
  }
  return hits;
}

