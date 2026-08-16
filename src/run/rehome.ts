/**
 * Re-homing: at the end of a run, the delivery's standing checks move
 * from delivery coordinates into code coordinates.
 *
 * A probe is born as `probes/<space>__SL-n_AC-k.test.mjs` — filed under
 * the event that produced it. Left there, it is a one-run test that lives
 * forever: nothing runs it again, nobody maintains it, and the next
 * dispatch's blast-radius scan treats it as held-out evidence and refuses
 * the run. So once the gate has graded, each probe's substance is merged
 * into the repository's OWN suite at the module test home its promise
 * lands at, under the repository's own conventions — and the criterion
 * records a proof anchor (file › test name) pointing at where its check
 * went on living. The probe file is then deleted; the delivery record
 * keeps the verdicts.
 *
 * Evidence lives at the address of what it proves; the event side keeps
 * pointers into subject space, never the reverse.
 *
 * Fail-soft in both directions: a re-homing that leaves the suite red is
 * reverted (the probes stay, spoken), and a probe the round could not
 * place stays a probe, named in the notes.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runAuthoringRound } from "./author";
import { isProbePath, isTestPath } from "./testHomes";
import { accessSync } from "node:fs";
import type { SliceForDag } from "../engine/core/dag";
import type { Space } from "../core/schema";
import { porcelainPaths } from "./worker";
import type { Exec } from "./oracle";

export interface RehomeCheck {
  /** The probe's path in the worktree, as the run authored it. */
  probe: string;
  criterionId: string;
  /** The criterion's words — what the merged scenario must keep proving. */
  check: string;
  /** Where the promise lands — the modules whose test homes are candidates. */
  lands: string[];
}

export interface RehomedAnchor {
  criterionId: string;
  path: string;
  test?: string;
}

/** A test home is any test-shaped path that is not held-out evidence. */
const suiteTestFile = (rel: string): boolean => isTestPath(rel) && !isProbePath(rel);

export async function rehomeProbes(args: {
  worktree: string;
  model: string;
  checks: RehomeCheck[];
  digest?: string;
  testConvention?: string;
  /** The repository's own suite — the merge is valid only if it stays green. */
  suite: () => Promise<boolean>;
  exec: Exec;
  log: (line: string) => void;
  author?: typeof runAuthoringRound;
}): Promise<{ anchors: RehomedAnchor[]; notes: string[] }> {
  const anchors: RehomedAnchor[] = [];
  const notes: string[] = [];
  if (!args.checks.length) return { anchors, notes };

  const before = new Set(await porcelainPaths(args.worktree));
  const listed = args.checks
    .map(
      (c, i) =>
        `${i + 1}. probe: ${c.probe}\n   proves: ${c.check}\n   its promise lands at: ${c.lands.join(", ") || "(unknown)"}`,
    )
    .join("\n");
  const reply = await (args.author ?? runAuthoringRound)(
    {
      cwd: args.worktree,
      model: args.model,
      allowWrite: suiteTestFile,
      log: args.log,
      maxTurns: 80,
    },
    [
      "You are RE-HOMING a delivery's checks: each probe below proved one",
      "criterion at the delivery gate and must now live in the repository's",
      "OWN test suite, at the test home of the module its promise lands at —",
      "following the repository's conventions, not the probe's.",
      "",
      args.digest ? `THE REPOSITORY'S CONVENTIONS (an established reading):\n${args.digest}\n` : "",
      args.testConvention ? `HOW TESTS RUN HERE: ${args.testConvention}\n` : "",
      "For each check:",
      "- Find the module's test home (create it beside the module, named by",
      "  the repo's convention, when none exists).",
      "- Merge the probe's substance there as ONE scenario named for the",
      "  behavior it proves — if an existing scenario already owns that",
      "  promise, sharpen it instead of duplicating it.",
      "- The scenario must keep proving the criterion's words. Never weaken it.",
      "- NEVER edit or delete the probe files themselves, and never touch",
      "  production code.",
      "",
      "THE CHECKS:",
      listed,
      "",
      'End with ONE JSON object and nothing else:\n{"moved":[{"probe":"…","path":"…","test":"the scenario\'s exact name"}]}',
      "List only what you actually placed; a probe you could not place is left out.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (reply === null) {
    notes.push("re-homing round unavailable — the checks stay as probes");
    return { anchors, notes };
  }

  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  let moved: { probe?: string; path?: string; test?: string }[] = [];
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as { moved?: unknown };
    moved = Array.isArray(parsed.moved) ? (parsed.moved as typeof moved) : [];
  } catch {
    notes.push("re-homing reported nothing parseable — the checks stay as probes");
  }

  const byProbe = new Map(args.checks.map((c) => [c.probe, c]));
  const placed: { check: RehomeCheck; path: string; test?: string }[] = [];
  for (const m of moved) {
    const check = m.probe ? byProbe.get(m.probe) : undefined;
    const rel = typeof m.path === "string" ? m.path.trim() : "";
    if (!check || !rel || !suiteTestFile(rel)) continue;
    try {
      await fs.access(path.join(args.worktree, rel));
    } catch {
      continue;
    }
    placed.push({ check, path: rel, ...(m.test ? { test: m.test } : {}) });
  }

  // The merge is only real if the repository's own suite says so.
  const green = placed.length ? await args.suite() : true;
  if (!green) {
    const after = await porcelainPaths(args.worktree);
    const touched = after.filter((p) => !before.has(p));
    for (const p of touched) {
      await args
        .exec("git", ["-C", args.worktree, "restore", "--source=HEAD", "--staged", "--worktree", "--", p], args.worktree)
        .catch(() => {});
      await args.exec("git", ["-C", args.worktree, "clean", "-fq", "--", p], args.worktree).catch(() => {});
    }
    notes.push(
      `re-homing left the suite red — reverted; ${args.checks.length} check(s) stay as probes`,
    );
    args.log(`re-homing: suite red, reverted — the checks stay as probes`);
    return { anchors, notes };
  }

  for (const p of placed) {
    await fs.rm(path.join(args.worktree, p.check.probe), { force: true }).catch(() => {});
    anchors.push({
      criterionId: p.check.criterionId,
      path: p.path,
      ...(p.test ? { test: p.test } : {}),
    });
  }
  const unplaced = args.checks.filter((c) => !placed.some((p) => p.check === c));
  for (const u of unplaced)
    notes.push(`${u.probe} was not re-homed — it stays a probe`);
  if (placed.length)
    args.log(
      `re-homed ${placed.length} check(s) into the suite` +
        (unplaced.length ? `; ${unplaced.length} stayed as probes` : ""),
    );
  return { anchors, notes };
}


/** Probe path → the criterion it proves, from the adapter's bookkeeping. */
export function criterionMapOf(slices: SliceForDag[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of slices) {
    const ids = (s as { criterionIds?: string[] }).criterionIds ?? [];
    s.workUnits
      .filter((u) => u.role === "test")
      .forEach((u, k) => {
        if (ids[k]) map.set(u.footprint[0], ids[k]);
      });
  }
  return map;
}

/** Assemble the gate's re-homing inputs from the space and hand off. */
export async function rehomeAtGate(args: {
  worktree: string;
  space: Space;
  criterionByProbe: Map<string, string>;
  model: string;
  digest?: string;
  testConvention?: string;
  suite: () => Promise<boolean>;
  exec: Exec;
  log: (line: string) => void;
  rehome: typeof rehomeProbes;
}): Promise<RehomedAnchor[]> {
  const checks = [...args.criterionByProbe.entries()]
    .filter(([probe]) => {
      try {
        accessSync(path.join(args.worktree, probe));
        return true;
      } catch {
        return false;
      }
    })
    .map(([probe, criterionId]) => {
      const node = args.space.nodes.find((n) => n.acceptance.some((a) => a.id === criterionId));
      const check = node?.acceptance.find((a) => a.id === criterionId);
      return {
        probe,
        criterionId,
        check: check?.text ?? "",
        lands: (node?.grounding?.touchpoints ?? []).map((t) => t.path),
      };
    });
  const r = await args.rehome({
    worktree: args.worktree,
    model: args.model,
    checks,
    ...(args.digest ? { digest: args.digest } : {}),
    ...(args.testConvention ? { testConvention: args.testConvention } : {}),
    suite: args.suite,
    exec: args.exec,
    log: args.log,
  });
  for (const n of r.notes) args.log(`re-homing: ${n}`);
  return r.anchors;
}


/** The check behind a slice's ordinal, resolved from the space — the
 *  probe never carries delivery bookkeeping. */
export function criterionLookup(
  slices: SliceForDag[],
  space: Space,
): (slice: string, ac: number) => { id: string; text: string } | undefined {
  return (slice, ac) => {
    const ids = (slices.find((x) => x.handle === slice) as { criterionIds?: string[] })
      ?.criterionIds;
    const id = ids?.[ac - 1];
    if (!id) return undefined;
    for (const n of space.nodes) {
      const c = n.acceptance.find((a) => a.id === id);
      if (c) return { id, text: c.text };
    }
    return undefined;
  };
}
