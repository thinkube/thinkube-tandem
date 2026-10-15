/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One shared fixture per run, written once and used by every check.
 *
 * When several testers of one run will double the same seam and the
 * repository has no shared fixture for it, each writes its own fake, and
 * each fake drifts from the production path in its own way. Instead, the
 * first of those testers writes one fixture in the repository's test home;
 * the others wait for it in the schedule — a real edge on that tester — and
 * start once it is committed, so every check reads the same double.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fixtureCovers, type Seam, type SharedFixture } from "./seams";
import { isProbePath } from "../core/testShape";
import type { Exec } from "./oracle";
import type { SliceForDag } from "../engine/core/dag";

interface FixturePlan {
  /** The tester that writes the fixture. */
  owner: string;
  /** Repository-relative path of the fixture it writes. */
  path: string;
  /** The seams the fixture doubles. */
  seams: Seam[];
  /** Testers that wait for the fixture before they start. */
  waiters: string[];
}

const escape = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a tester's own reading names a seam: its function as a whole
 *  word, or its module as a path or a dotted name. A module at the root has
 *  no path to name it by, so only its file name counts. */
function names(text: string, s: Seam): boolean {
  const mod = s.file.replace(/\.[^./]+$/, "");
  const paths = [s.file, ...(mod.includes("/") ? [mod, mod.replace(/\//g, ".")] : [])];
  return (
    new RegExp(`(?<![\\w$])${escape(s.fn)}(?![\\w$])`).test(text) ||
    paths.some((p) => new RegExp(`(?<![\\w$./])${escape(p)}(?![\\w$])`).test(text))
  );
}

/**
 * What a tester is briefed from, as one text to look for seams in: its
 * slice's criteria and contract, the notes of its slice's units, and the
 * production files its slice's code changes, consumes or reads — their
 * paths, and the source of each that exists in the tree.
 */
export async function testerReading(
  tree: string,
  slice: SliceForDag,
  criteria: readonly string[],
): Promise<string> {
  const code = slice.workUnits.filter((w) => (w.role ?? "code") !== "test");
  const files = [...new Set(code.flatMap((w) => [...w.footprint, ...(w.consumes ?? []), ...(w.reads ?? [])]))];
  const sources: string[] = [];
  for (const rel of files) {
    const abs = path.join(tree, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) sources.push(fs.readFileSync(abs, "utf8"));
  }
  return [
    ...criteria,
    slice.contract ?? "",
    ...slice.workUnits.map((w) => w.note ?? ""),
    ...files,
    ...sources,
  ].join("\n");
}

/** Where the shared fixture lives for checks written beside `probe`, by
 *  the convention of the probe's language; undefined for a language with
 *  no such convention here. */
export function fixturePathFor(probe: string): string | undefined {
  const dir = path.posix.dirname(probe);
  const at = (f: string) => (dir === "." ? f : `${dir}/${f}`);
  if (probe.endsWith(".py")) return at("conftest.py");
  if (probe.endsWith(".go")) return at("seams_fixture_test.go");
  const ext = /\.([cm]?[jt])sx?$/.exec(probe);
  return ext ? at(`seams.fixture.${ext[1]}s`) : undefined;
}

/** Whether a check at `probe` reaches a fixture at `fixture`: a conftest.py
 *  reaches every directory below its own; a module is reached from where
 *  it sits. */
function reaches(fixture: string, probe: string): boolean {
  const fdir = path.posix.dirname(fixture);
  const pdir = path.posix.dirname(probe);
  if (fixture.endsWith("conftest.py")) return fdir === "." || pdir === fdir || pdir.startsWith(fdir + "/");
  return pdir === fdir;
}

/**
 * Plan the run's shared fixture. `testers` are the run's tester units still
 * to run, in schedule order, each with the text it is briefed from (its
 * slice's criteria, contract, notes and the production files it touches).
 * A seam is shared when no fixture already doubles it and the texts of two
 * or more testers name it. The first such tester owns the fixture; every
 * other tester whose checks reach the fixture waits for it.
 */
export function planSharedFixture(a: {
  testers: readonly { id: string; footprint: readonly string[]; text: string }[];
  seams: readonly Seam[];
  fixtures: readonly SharedFixture[];
}): FixturePlan | undefined {
  const open = a.seams.filter((s) => !fixtureCovers(a.fixtures, s));
  const shared = open.filter((s) => a.testers.filter((t) => names(t.text, s)).length >= 2);
  if (!shared.length) return undefined;
  const users = a.testers.filter((t) => shared.some((s) => names(t.text, s)) && t.footprint.some(isProbePath));
  const owner = users[0];
  if (!owner) return undefined;
  const fixture = fixturePathFor(owner.footprint.find(isProbePath)!);
  if (!fixture) return undefined;
  const waiters = users.slice(1).filter((t) => t.footprint.filter(isProbePath).some((p) => reaches(fixture, p)));
  if (!waiters.length) return undefined;
  return { owner: owner.id, path: fixture, seams: shared, waiters: waiters.map((t) => t.id) };
}

/** Put the plan into the schedule: the fixture joins its owner's
 *  footprint, and every waiter requires the owner. A tester the owner
 *  itself waits on, directly or through others, cannot wait for the owner
 *  without both waiting forever: it is dropped from the waiters. */
export function applyFixturePlan(
  dag: { id: string; footprint: string[]; requires: string[] }[],
  plan: FixturePlan,
): void {
  const byId = new Map(dag.map((u) => [u.id, u]));
  const ownerWaitsOn = new Set<string>();
  const visit = (id: string): void => {
    for (const r of byId.get(id)?.requires ?? [])
      if (!ownerWaitsOn.has(r)) {
        ownerWaitsOn.add(r);
        visit(r);
      }
  };
  visit(plan.owner);
  plan.waiters = plan.waiters.filter((w) => !ownerWaitsOn.has(w));
  for (const u of dag) {
    if (u.id === plan.owner && !u.footprint.includes(plan.path)) u.footprint.push(plan.path);
    if (plan.waiters.includes(u.id) && !u.requires.includes(plan.owner)) u.requires.push(plan.owner);
  }
}

/**
 * Commit the fixture on the run branch the moment its owner finishes, so
 * every runner that grades a waiter's checks — the committed base plus that
 * slice's own files — holds it. The message carries text after the slice
 * handle, so a later resume never reads it as a finished slice.
 */
export async function commitSharedFixture(a: {
  worktree: string;
  tep: string;
  slice: string;
  plan: FixturePlan;
  exec: Exec;
  log: (line: string) => void;
}): Promise<void> {
  if (!fs.existsSync(path.join(a.worktree, a.plan.path))) {
    a.log(`⚠ ${a.plan.owner}: the shared fixture ${a.plan.path} was not written — the testers waiting on it write their own doubles`);
    return;
  }
  const add = await a.exec("git", ["add", "--", a.plan.path], a.worktree);
  if (add.code !== 0) throw new Error(`the shared fixture ${a.plan.path} could not be staged: ${add.out.trim()}`);
  const staged = await a.exec("git", ["diff", "--cached", "--quiet", "--", a.plan.path], a.worktree);
  if (staged.code === 0) {
    a.log(`✓ ${a.plan.owner}: the shared fixture ${a.plan.path} is unchanged on the branch`);
    return;
  }
  const c = await a.exec(
    "git",
    ["commit", "-m", `tandem: ${a.tep} ${a.slice} — partial: shared fixture ${a.plan.path}`, "--", a.plan.path],
    a.worktree,
  );
  if (c.code !== 0) throw new Error(`the shared fixture ${a.plan.path} could not be committed: ${c.out.trim()}`);
  a.log(`✓ ${a.plan.owner}: the shared fixture ${a.plan.path} is committed — ${a.plan.waiters.join(", ")} use it`);
}
