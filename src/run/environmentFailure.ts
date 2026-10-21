/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Signs that a check failed for its environment, not for the code.
 *
 * A check that cannot load what it exercises — a component the test
 * environment does not resolve, a module the runner cannot import — fails
 * whatever the code does, as long as the thing it cannot load exists in the
 * tree. A judge reading such a failure as the code's sends the coder after
 * something no code change can reach. These signs are read from what the
 * check printed and confirmed against the tree's own files, so a judge sees
 * them stated, with the file that exists beside each.
 */
import * as path from "node:path";

/** One thing the check could not load, though the tree holds it. */
export interface EnvironmentSign {
  /** What the runner said it could not load. */
  missing: string;
  /** The tree's file that provides it. */
  file: string;
}

const stem = (f: string): string => f.replace(/\.[^./]+$/, "");

/** Each sign in `output` whose missing thing a file of `repoFiles` provides. */
export function environmentSigns(output: string, repoFiles: readonly string[]): EnvironmentSign[] {
  const found = new Map<string, EnvironmentSign>();
  const add = (missing: string, file: string | undefined) => {
    if (file && !found.has(missing)) found.set(missing, { missing, file });
  };
  // Vue: a component the template names that no registration resolved.
  for (const m of output.matchAll(/Failed to resolve component: ([A-Za-z][\w-]*)/g))
    add(`the component ${m[1]}`, repoFiles.find((f) => path.posix.basename(f) === `${m[1]}.vue`));
  // Vite: an import from one file to another, by a path relative to the importer.
  for (const m of output.matchAll(/Failed to resolve import "(\.{1,2}\/[^"]+)" from "([^"]+)"/g)) {
    const target = stem(path.posix.normalize(path.posix.join(path.posix.dirname(m[2]), m[1])));
    add(`the import ${m[1]} from ${m[2]}`, repoFiles.find((f) => stem(f) === target || f.endsWith(`/${target}`) || stem(f).endsWith(`/${target}`)));
  }
  // Node: a module by a relative path, matched on its last segments.
  for (const m of output.matchAll(/Cannot find module '(\.{0,2}\/[^']+)'/g)) {
    const tail = stem(m[1].replace(/^(\.{1,2}\/)+/, ""));
    add(`the module ${m[1]}`, repoFiles.find((f) => stem(f) === tail || stem(f).endsWith(`/${tail}`)));
  }
  // Python: a dotted module that a file or package of the tree provides.
  for (const m of output.matchAll(/ModuleNotFoundError: No module named '([\w.]+)'/g)) {
    const rel = m[1].replace(/\./g, "/");
    add(
      `the module ${m[1]}`,
      repoFiles.find((f) => f === `${rel}.py` || f.endsWith(`/${rel}.py`) || f === `${rel}/__init__.py` || f.endsWith(`/${rel}/__init__.py`)),
    );
  }
  return [...found.values()];
}

/** The signs as a judge reads them, or "" when there are none. */
export function environmentStanza(signs: readonly EnvironmentSign[]): string {
  if (!signs.length) return "";
  return [
    "──── THE TEST ENVIRONMENT COULD NOT LOAD THESE, THOUGH THE TREE HOLDS THEM ────",
    ...signs.map((s) => `- ${s.missing} — provided by ${s.file}`),
    "A check that fails because its environment cannot load something the tree holds cannot be passed by",
    "any change to the code under test: rule it DEFECTIVE, and say what the environment lacks, so the check",
    "is rewritten to reach the code the way this repository's own tests do.",
  ].join("\n");
}
