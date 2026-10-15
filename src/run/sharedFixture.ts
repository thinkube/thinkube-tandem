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

/** The production code a tester's slice works on: every file its code
 *  units change, consume or read, and the source of each that exists. */
export interface TesterCode {
  files: string[];
  sources: { rel: string; text: string }[];
}

const escape = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The dotted module a Python file is imported as, from the repository
 *  root. */
const pyModule = (rel: string): string => rel.replace(/\.py$/, "").replace(/\/__init__$/, "").replace(/\//g, ".");

/** Whether an imported module name is the module at `file`: the package
 *  root may sit below the repository root (`backend/app/x.py` is imported
 *  as `app.x`), so the name matches the module's dotted ending. */
const isModule = (imported: string, file: string): boolean =>
  imported !== "" && (file === imported || file.endsWith(`.${imported}`));

/** The modules a Python source imports, absolute, with the names it takes
 *  from each (`*` when it imports the module itself). A relative import is
 *  resolved against the importing file's package. */
function pythonImports(rel: string, text: string): { module: string; names: string[] }[] {
  const pkg = pyModule(rel).split(".").slice(0, -1);
  const absolute = (dots: string, rest: string): string =>
    dots ? [...pkg.slice(0, pkg.length - (dots.length - 1)), ...(rest ? [rest] : [])].join(".") : rest;
  const out: { module: string; names: string[] }[] = [];
  for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(?:\(([^)]*)\)|([^\n]+))/gm))
    out.push({
      module: absolute(m[1], m[2]),
      names: (m[3] ?? m[4]).split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean),
    });
  for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w.]+)/gm)) out.push({ module: m[1], names: ["*"] });
  return out;
}

/** The repository files a script source imports by a relative specifier,
 *  without their extension. */
function scriptImports(rel: string, text: string): string[] {
  const dir = path.posix.dirname(rel);
  const specs = [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm)].map((m) => m[1]);
  return specs.map((sp) => path.posix.normalize(path.posix.join(dir, sp)).replace(/\.[cm]?[jt]sx?$/, ""));
}

/** Whether a production source calls a seam's function, imported from the
 *  module that defines it. */
function callsSeam(src: { rel: string; text: string }, s: Seam): boolean {
  if (src.rel === s.file) return false;
  const call = new RegExp(`(?<![\\w$])${escape(s.fn)}\\s*\\(`);
  if (!call.test(src.text)) return false;
  if (s.file.endsWith(".py")) {
    const mod = pyModule(s.file);
    const parent = mod.split(".").slice(0, -1).join(".");
    const last = mod.split(".").pop()!;
    return pythonImports(src.rel, src.text).some(
      (i) =>
        (isModule(i.module, mod) && (i.names.includes(s.fn) || i.names.includes("*"))) ||
        (isModule(i.module, parent) && i.names.includes(last)),
    );
  }
  const target = s.file.replace(/\.[cm]?[jt]sx?$/, "");
  return scriptImports(src.rel, src.text).some((f) => f === target || f === target.replace(/\/index$/, ""));
}

/** Whether a tester's slice works with a seam: its code works on the file
 *  that defines the seam, or calls the seam's function from that file. */
function uses(code: TesterCode, s: Seam): boolean {
  return code.files.includes(s.file) || code.sources.some((src) => callsSeam(src, s));
}

/** The production code a tester's slice works on, read from the tree. */
export async function testerCode(tree: string, slice: SliceForDag): Promise<TesterCode> {
  const code = slice.workUnits.filter((w) => (w.role ?? "code") !== "test");
  const files = [...new Set(code.flatMap((w) => [...w.footprint, ...(w.consumes ?? []), ...(w.reads ?? [])]))];
  const sources: { rel: string; text: string }[] = [];
  for (const rel of files) {
    const abs = path.join(tree, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) sources.push({ rel, text: fs.readFileSync(abs, "utf8") });
  }
  return { files, sources };
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
 * to run, in schedule order, each with the production code its slice works
 * on. A seam is shared when no fixture already doubles it and the code of
 * two or more testers' slices uses it. The first such tester owns the
 * fixture; every other tester whose checks reach the fixture waits for it.
 */
export function planSharedFixture(a: {
  testers: readonly { id: string; footprint: readonly string[]; code: TesterCode }[];
  seams: readonly Seam[];
  fixtures: readonly SharedFixture[];
}): FixturePlan | undefined {
  const open = a.seams.filter((s) => !fixtureCovers(a.fixtures, s));
  const shared = open.filter((s) => a.testers.filter((t) => uses(t.code, s)).length >= 2);
  if (!shared.length) return undefined;
  const users = a.testers.filter((t) => shared.some((s) => uses(t.code, s)) && t.footprint.some(isProbePath));
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
 * handle, so a later resume never reads it as a finished slice. False when
 * the owner did not write the fixture: its waiters were scheduled to use it,
 * so the owner has not done its work.
 */
export async function commitSharedFixture(a: {
  worktree: string;
  tep: string;
  slice: string;
  plan: FixturePlan;
  exec: Exec;
  log: (line: string) => void;
}): Promise<boolean> {
  if (!fs.existsSync(path.join(a.worktree, a.plan.path))) return false;
  const add = await a.exec("git", ["add", "--", a.plan.path], a.worktree);
  if (add.code !== 0) throw new Error(`the shared fixture ${a.plan.path} could not be staged: ${add.out.trim()}`);
  const staged = await a.exec("git", ["diff", "--cached", "--quiet", "--", a.plan.path], a.worktree);
  if (staged.code === 0) {
    a.log(`✓ ${a.plan.owner}: the shared fixture ${a.plan.path} is unchanged on the branch`);
    return true;
  }
  const c = await a.exec(
    "git",
    ["commit", "-m", `tandem: ${a.tep} ${a.slice} — partial: shared fixture ${a.plan.path}`, "--", a.plan.path],
    a.worktree,
  );
  if (c.code !== 0) throw new Error(`the shared fixture ${a.plan.path} could not be committed: ${c.out.trim()}`);
  a.log(`✓ ${a.plan.owner}: the shared fixture ${a.plan.path} is committed — ${a.plan.waiters.join(", ")} use it`);
  return true;
}
