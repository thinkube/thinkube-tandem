#!/usr/bin/env node
/**
 * PreToolUse(Edit|Write) ownership guard (SP-tgpwbm AC4 / TEP-tgpupa).
 *
 * Refuses an edit to a file the active slice does not own, per the ownership
 * arbiter's durable store. Exit 0 = allow; exit 2 = block (stderr is shown to
 * Claude so it can pick a file it owns).
 *
 * Fail-open by design: when the feature isn't engaged — no active slice, or the
 * active slice holds no claims — it allows the edit, so the hook never bricks
 * editing in an ordinary (non-parallel) session.
 *
 * Inputs:
 *   stdin                          — the PreToolUse JSON, i.e.
 *                                    { tool_name, tool_input: { file_path } }.
 *   env THINKUBE_ACTIVE_SLICE      — the active slice handle (e.g. SP-3_SL-2).
 *   env THINKUBE_OWNERSHIP_JOURNAL — path to the arbiter's journal JSON; when
 *                                    unset, ownership is read from git refs
 *                                    (refs/locks/*) in the repo.
 *   env THINKUBE_REPO_ROOT         — repo root used to relativize an absolute
 *                                    file_path (defaults to git toplevel of cwd).
 *
 * The decision mirrors src/methodology/parallelSlices.ts acquireClaim semantics:
 * a file owned by the active slice is allowed; a file owned by another slice (or
 * unclaimed while the slice holds a claim) is refused.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

function allow() {
  process.exit(0);
}
function block(msg) {
  process.stderr.write(msg + "\n");
  process.exit(2);
}

function normalize(p) {
  const t = String(p).trim().replace(/\\/g, "/");
  return t.startsWith("./") ? t.slice(2) : t;
}

function repoRoot() {
  if (process.env.THINKUBE_REPO_ROOT) return process.env.THINKUBE_REPO_ROOT;
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return process.cwd();
  }
}

function relFile(file) {
  const f = String(file);
  if (path.isAbsolute(f)) return normalize(path.relative(repoRoot(), f));
  return normalize(f);
}

/** The durable ownership map: normalized repo-relative file → owning slice. */
function loadOwnership() {
  const journal = process.env.THINKUBE_OWNERSHIP_JOURNAL;
  if (journal) {
    try {
      const parsed = JSON.parse(readFileSync(journal, "utf8"));
      const claims = parsed && parsed.claims;
      const map = {};
      if (claims && typeof claims === "object" && !Array.isArray(claims)) {
        for (const [f, s] of Object.entries(claims)) {
          if (typeof s === "string" && s) map[normalize(f)] = s;
        }
      }
      return map;
    } catch {
      return {};
    }
  }
  // git-refs store (refs/locks/<hex(path)> blob = slice handle).
  try {
    const root = repoRoot();
    const out = execFileSync(
      "git",
      [
        "-C",
        root,
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/locks/",
      ],
      { encoding: "utf8" },
    );
    const map = {};
    for (const line of out.split(/\r?\n/)) {
      const sp = line.indexOf(" ");
      if (sp === -1) continue;
      const hex = line.slice(0, sp).replace(/^refs\/locks\//, "");
      const oid = line.slice(sp + 1).trim();
      let file;
      try {
        file = Buffer.from(hex, "hex").toString("utf8");
      } catch {
        continue;
      }
      try {
        const slice = execFileSync(
          "git",
          ["-C", root, "cat-file", "blob", oid],
          {
            encoding: "utf8",
          },
        ).trim();
        if (file && slice) map[normalize(file)] = slice;
      } catch {
        // dangling ref — skip
      }
    }
    return map;
  } catch {
    return {};
  }
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    input = {};
  }

  const tool = input.tool_name;
  // Only guard file-editing tools; the settings matcher already scopes this,
  // but stay defensive if invoked directly.
  if (tool && tool !== "Edit" && tool !== "Write" && tool !== "MultiEdit") {
    allow();
  }

  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath) allow();

  const activeSlice = (process.env.THINKUBE_ACTIVE_SLICE || "").trim();
  if (!activeSlice) allow(); // feature not engaged

  const ownership = loadOwnership();
  const owns = Object.values(ownership).includes(activeSlice);
  if (!owns) allow(); // the active slice holds no claims — don't enforce

  const target = relFile(filePath);
  const owner = ownership[target];
  if (owner === activeSlice) allow();

  block(
    `[thinkube] ownership guard: ${activeSlice} may not edit ${target}` +
      (owner
        ? ` — it is owned by ${owner}.`
        : ` — it is outside ${activeSlice}'s claimed file set.`),
  );
}

main();
