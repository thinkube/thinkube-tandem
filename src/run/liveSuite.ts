/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The live suite a repository declares, and whether its home stands apart
 * from the unit suite.
 *
 * A live check exercises the deployed service through its public API: it
 * needs the network, a deploy behind it, and the platform's token. The
 * unit suite runs where none of that exists — in a worktree at the gate,
 * and in the image build — so a live check it collected would fail there
 * for the machine's limits and blame the work. The repository declares the
 * home (`spec.deploy.live.home`); this says whether that home is clear of
 * every directory the unit suite collects, read from where the repository
 * keeps its unit tests and the parts it declares.
 */
import * as fs from "fs";
import * as path from "path";
import { thinkubeDeclaration, type ThinkubeLive } from "../core/thinkubeYaml";
import { isProbePath, isTestPath } from "../core/testShape";

/** The live checks a repository declares, with the address they run against. */
export type LiveSuite = ThinkubeLive & { at: string };

/** The live suite this repository declares, or nothing when it declares
 *  none or its declaration cannot be read. */
export function liveSuiteDeclared(repoRoot: string): LiveSuite | undefined {
  const read = thinkubeDeclaration(repoRoot);
  const d = read && "declared" in read ? read.declared.deploy : undefined;
  return d?.live && d.at ? { ...d.live, at: d.at } : undefined;
}

/** Whether a repository-relative path lies at or under a directory. */
function isUnder(f: string, dir: string): boolean {
  return f === dir || f.startsWith(`${dir}/`);
}

/** The environment variable a live check reads the service's address from. */
const LIVE_URL_ENV = "TANDEM_LIVE_URL";

/** Whether a repository file reads the live address, which makes it a live
 *  check whatever it is named. */
export function readsLiveUrl(repoRoot: string): (rel: string) => boolean {
  return (rel) => {
    if (!rel) return false;
    const at = path.join(repoRoot, rel);
    let isFile = false;
    try {
      isFile = fs.statSync(at).isFile();
    } catch {
      return false;
    }
    return isFile && fs.readFileSync(at, "utf8").includes(LIVE_URL_ENV);
  };
}

/**
 * Why live checks may not be kept at `home`, or nothing when they may.
 *
 * Refused when the home is a file, when it already holds a unit test, when
 * it sits inside a top-level directory that holds the repository's unit
 * tests, and when it sits inside a declared part other than the whole
 * repository, whose own suite runs over its tree. A test that reads the
 * live address is a live check, kept as a standing one, not a unit test.
 */
export function liveHomeRefusal(
  home: string,
  repoFiles: readonly string[],
  parts: readonly { root: string }[],
  isLive: (rel: string) => boolean,
): string | undefined {
  const files = repoFiles.filter(Boolean);
  if (files.includes(home)) return `live.home \`${home}\` is a file in the repository, not a directory`;
  const unit = files.filter((f) => isTestPath(f) && !isProbePath(f) && !isLive(f));
  const inside = unit.find((f) => isUnder(f, home));
  if (inside)
    return `live.home \`${home}\` already holds the unit test ${inside} — the unit suite runs there, so it would collect the live checks`;
  const suiteDir = unit
    .filter((f) => f.includes("/"))
    .map((f) => ({ dir: f.split("/")[0], f }))
    .find((t) => isUnder(home, t.dir));
  if (suiteDir)
    return (
      `live.home \`${home}\` is inside \`${suiteDir.dir}\`, where the unit suite's tests live (${suiteDir.f}) — ` +
      "the unit suite would collect the live checks, which need the network and a deployed service"
    );
  const part = parts.find((p) => p.root !== "." && isUnder(home, p.root));
  if (part)
    return (
      `live.home \`${home}\` is inside the declared part \`${part.root}\`, whose own suite runs over its tree — ` +
      "keep the live checks in a directory of their own"
    );
  return undefined;
}
