/**
 * One word per thing, in every surface.
 *
 * The surface once called the same objects "Rules" in the code, "In force"
 * in the rail and "holds across all of them" on the page, and rendered a
 * subject's claims as unlabelled lines under an unlabelled name. A reader
 * then has to solve a riddle to know what they are looking at, and no
 * amount of care prevents it coming back — so the words are checked.
 *
 * The vocabulary is small and every part of it is the human's: an ASK is
 * what they wrote, a SUBJECT is a thing their asks are about, a CLAIM is
 * what must become true of a subject, a RULE is what holds across every
 * subject, a PROMISE is a change that makes a claim true, and a CHECK is
 * what proves a promise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const surfaceDir = path.resolve(__dirname, "..", "..", "webview", "map", "src");

/** Phrases that name something the glossary already names. */
const SYNONYMS: { bad: RegExp; use: string }[] = [
  { bad: /\bin force\b/i, use: "Rule" },
  { bad: /holds across all/i, use: "Rule" },
  { bad: /\bgoverns everything\b/i, use: "Rule" },
  { bad: /\bthings? to build\b/i, use: "Promise" },
  { bad: /\bproof labels?\b/i, use: "Check" },
];

function surfaces(): { file: string; text: string }[] {
  return fs
    .readdirSync(surfaceDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(surfaceDir, f), "utf8") }));
}

/** Only what a person reads: JSX text and title attributes. */
function humanText(source: string): string {
  const titles = [...source.matchAll(/title=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
  const between = [...source.matchAll(/>\s*([A-Za-z][^<>{}]{3,})</g)].map((m) => m[1]);
  return [...titles, ...between].join("\n");
}

test("no surface invents a second name for something the glossary names", () => {
  const offences: string[] = [];
  for (const { file, text } of surfaces()) {
    const read = humanText(text);
    for (const { bad, use } of SYNONYMS)
      if (bad.test(read)) offences.push(`${file}: says ${bad} — the word is "${use}"`);
  }
  assert.deepEqual(offences, [], "one word per thing");
});

test("every group of shapes is labelled with the word for what it holds", () => {
  const intent = fs.readFileSync(path.join(surfaceDir, "IntentGraph.tsx"), "utf8");
  for (const word of ["Subject", "Claims", "Rules"])
    assert.ok(
      new RegExp(`>\\s*\\n?\\s*${word}\\b`).test(intent),
      `the reading page never says "${word}" — an unlabelled shape is a riddle`,
    );
  const sentences = fs.readFileSync(path.join(surfaceDir, "Sentences.tsx"), "utf8");
  assert.ok(/>\s*\n?\s*Asks\b/.test(sentences), "your own words are labelled Asks");
});
