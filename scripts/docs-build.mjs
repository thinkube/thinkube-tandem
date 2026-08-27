#!/usr/bin/env node
// Worktree-safe Antora build for the `tandem` docs component.
//
// Runs docs/preview-playbook.yml from the repo root and always lands the built
// pages at docs/build/site/tandem/<file>.html.
//
// Antora 3.1 refuses a *linked git worktree* as a local content source (its
// `.git` is a file, not a directory). When we detect that case we stage the
// checkout into a throwaway git repo (git init && git add -A && git commit),
// build there with the same playbook semantics, and copy the produced site back.
//
// The playbook's `runtime.log.failure_level: warn` makes Antora exit non-zero on
// any warning as well as any error, so a failed/warned build propagates a
// non-zero exit from here. Exit 0 means a clean build.
//
// Node ESM, node builtins only.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const playbookRel = join("docs", "preview-playbook.yml");
const finalSite = join(repoRoot, "docs", "build", "site");

/** Resolve the locally-installed Antora CLI binary. */
function antoraBin() {
  const bin = join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "antora.cmd" : "antora",
  );
  if (!existsSync(bin)) {
    console.error(
      `[docs-build] Antora CLI not found at ${bin}.\n` +
        `[docs-build] Install dev dependencies first: npm install`,
    );
    process.exit(1);
  }
  return bin;
}

/** Run Antora against `playbookPath` with `cwd`. Returns the child status. */
function runAntora(playbookPath, cwd) {
  const result = spawnSync(antoraBin(), ["--fetch", playbookPath], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(
      `[docs-build] Failed to launch Antora: ${result.error.message}`,
    );
    process.exit(1);
  }
  return result.status ?? 1;
}

/** `git` helper that fails loudly. */
function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(
      `[docs-build] git ${args.join(" ")} failed (exit ${result.status}).`,
    );
    process.exit(result.status ?? 1);
  }
}

/** Copy the produced site into docs/build/site, replacing any prior build. */
function publishSite(fromSite) {
  rmSync(finalSite, { recursive: true, force: true });
  mkdirSync(dirname(finalSite), { recursive: true });
  cpSync(fromSite, finalSite, { recursive: true });
}

function isLinkedWorktree() {
  const gitPath = join(repoRoot, ".git");
  if (!existsSync(gitPath)) return false;
  // A linked worktree's `.git` is a file ("gitdir: …"); a normal checkout's is a dir.
  return !lstatSync(gitPath).isDirectory();
}

function buildDirect() {
  // `.git` is a real directory — Antora accepts the checkout as a local source.
  // output.dir (docs/build/site) is resolved from the CWD, so run from the repo root.
  const status = runAntora(join(repoRoot, playbookRel), repoRoot);
  if (status !== 0) process.exit(status);
}

function buildStaged() {
  // Linked worktree: stage docs into a throwaway git repo Antora will accept.
  const stage = mkdtempSync(join(tmpdir(), "tandem-docs-"));
  const docsBuild = join(repoRoot, "docs", "build");
  let status = 1;
  try {
    // Copy the docs tree (excluding any prior build output) into <stage>/docs.
    cpSync(join(repoRoot, "docs"), join(stage, "docs"), {
      recursive: true,
      filter: (src) => src !== docsBuild && !src.startsWith(docsBuild + sep),
    });

    // Make it a real git repo so Antora's local-content aggregator is happy.
    git(["init", "-q"], stage);
    git(["add", "-A"], stage);
    git(
      [
        "-c",
        "user.email=docs-build@thinkube.local",
        "-c",
        "user.name=tandem-docs-build",
        "commit",
        "-q",
        "-m",
        "stage",
      ],
      stage,
    );

    // The staged playbook lives at <stage>/docs/preview-playbook.yml, so its
    // `url: ./..` resolves to <stage> (the git root) with start_path: docs.
    // Run from <stage> so output.dir (docs/build/site) lands under <stage>/docs.
    status = runAntora(join(stage, playbookRel), stage);
    if (status === 0) publishSite(join(stage, "docs", "build", "site"));
  } finally {
    // Always drop the throwaway repo. Do the exit *after* cleanup, because
    // process.exit() would otherwise skip this finally block and leak the dir.
    rmSync(stage, { recursive: true, force: true });
  }
  if (status !== 0) process.exit(status);
}

if (isLinkedWorktree()) {
  buildStaged();
} else {
  buildDirect();
}

console.log(`[docs-build] Site written to ${finalSite}`);
