/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How the repository's own tests reach code, shown to whoever writes a
 * check beside them.
 *
 * A test environment loads some things and not others — a frontend whose
 * module layers live elsewhere, a component tree that needs stubs, a
 * package path a runner sets up. The repository's existing tests in a test
 * home already reach code the way that environment allows. A check written
 * another way can fail for the environment whatever the code does, so the
 * writer sees how those tests import, mount and stub before writing.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isProbePath, isTestPath } from "../core/testShape";

/** Existing tests shown per test home, and how much of each. */
const PER_HOME = 3;
const LINES = 30;
const CHARS = 1500;

/** A test that mounts or renders something shows more of what the
 *  environment allows than one that calls a pure function. */
const mounts = (src: string): boolean => /\bmount(Suspended)?\s*\(|\brender\s*\(|TestClient\s*\(|\bshallowMount\s*\(/.test(src);

/** The opening of the existing tests in each test home `checks` land in. */
export async function testHomeStanza(tree: string, checks: readonly string[]): Promise<string> {
  const homes = [...new Set(checks.filter(isProbePath).map((c) => path.posix.dirname(c)))];
  const parts: string[] = [];
  for (const home of homes) {
    let names: string[];
    try {
      names = await fs.readdir(path.join(tree, home));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        parts.push(`── ${home}/ ── holds no test yet: your checks are the first here.`);
        continue;
      }
      throw e;
    }
    const tests: { rel: string; src: string }[] = [];
    for (const name of names.sort()) {
      const rel = home === "." ? name : `${home}/${name}`;
      if (!isTestPath(rel) || isProbePath(rel)) continue;
      const abs = path.join(tree, rel);
      if (!(await fs.stat(abs)).isFile()) continue;
      tests.push({ rel, src: await fs.readFile(abs, "utf8") });
    }
    if (!tests.length) {
      parts.push(`── ${home}/ ── holds no test of the repository's own yet: your checks are the first here.`);
      continue;
    }
    const shown = [...tests.filter((t) => mounts(t.src)), ...tests.filter((t) => !mounts(t.src))].slice(0, PER_HOME);
    for (const t of shown) parts.push(`── ${t.rel} ──\n${t.src.split("\n").slice(0, LINES).join("\n").slice(0, CHARS)}`);
  }
  if (!parts.length) return "";
  return (
    "\n\n──── HOW THIS REPOSITORY'S OWN TESTS REACH CODE (the test homes your checks go to) ────\n" +
    parts.join("\n") +
    "\n\nREACH CODE THE WAY THESE TESTS DO: import, mount and stub as they do. Their environment loads only " +
    "what they reach; a check that loads code another way — mounting a component tree none of them mounts, " +
    "importing across a boundary none of them crosses — can fail for the environment whatever the code does, " +
    "and then nothing the coder writes can make it pass."
  );
}
