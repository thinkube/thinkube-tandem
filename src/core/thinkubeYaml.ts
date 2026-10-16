/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a repository's `thinkube.yaml` — the platform's own declaration
 * of what an app is: its containers, how each is built and tested, and how
 * it deploys.
 *
 * READ AT THE MOMENT OF USE, NEVER PERSISTED. This file is authored truth;
 * a copy of it inside Tandem's own files would drift from the original and
 * the two would contradict — the exact disease the platform's own
 * documentation shows in three places (a spec naming a playbook that was
 * renamed, a README naming a framework that was replaced).
 *
 * The test block matters most here: `containers[].test` is a command run in
 * a NAMED IMAGE by the platform's build workflow, before the container
 * build, and a failure prevents deployment. Running that command in this
 * pod instead proves nothing — green or red — because the pod is not the
 * image. Tandem reads the declaration to know which criteria the pipeline
 * settles; it never executes it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

interface ThinkubeContainer {
  name: string;
  /** Build context relative to the repository root, e.g. "." or "./backend". */
  build: string;
  /** The CI test hook: run `command` in `image`, before the build; `one`
   *  runs a single test file, `<file>` relative to the build directory. */
  test?: ThinkubeTest;
  /** The path the running container answers a health probe at, such as
   *  "/health" — where a deploy is seen to have gone live. */
  health?: string;
}

/** A path of the deployed address, and the container that answers it. */
interface ThinkubeRoute {
  path: string;
  to: string;
}

interface ThinkubeTest {
  enabled: boolean;
  command?: string;
  image?: string;
  one?: string;
}

/**
 * A tree of the repository with its own toolchain. An application's parts
 * are its containers; a repository the platform does not deploy declares
 * them under `spec.parts`.
 */
export interface ThinkubePart {
  name: string;
  /** Repository-relative root, "/"-separated; "." is the whole repository. */
  root: string;
  test?: ThinkubeTest;
}

/**
 * How this repository is made live, in its own words.
 *
 * Every target on this platform reaches production differently: an app by
 * being pushed, a component by a playbook run from another repository, a
 * template through a call into control, this extension by a shell script
 * beside it. Nothing in Tandem needs to know which of those a repository
 * uses — only what to invoke and where the result can be seen afterwards.
 *
 * That is why this is a list of commands and not a named method. A method
 * name is a branch waiting to be written, and the next tool nobody has
 * chosen yet would need one. Adding a way to deploy is adding a line here.
 */
export interface ThinkubeDeploy {
  /** What to invoke, in order. Empty means the merge itself made it live. */
  run: string[];
  /** Where to run it, when that is not this repository — a component's
   *  deploy playbook lives in the core repo, not beside the code. */
  in?: string;
  /** Where the result can be seen once it is live, so the look has an
   *  address instead of a guess assembled from the directory name. */
  at?: string;
  /** The repository's live checks: what only the running service at `at`
   *  can answer, checked against it once it is live. */
  live?: ThinkubeLive;
}

/**
 * Where a repository keeps its live checks, and how one of them runs.
 *
 * A live check exercises the deployed service through its public API, so
 * it needs the network and a deploy behind it: it never runs in the unit
 * suite or an image build, only after the work is live.
 */
export interface ThinkubeLive {
  /** Repository-relative directory the live checks are minted in,
   *  "/"-separated, never the repository root. */
  home: string;
  /** The command that runs one live check; `<file>` is its
   *  repository-relative path. */
  one: string;
}

/** The `live` block as written, or why it cannot be used. Both fields are
 *  required: without `home` a check has nowhere to be minted, and without
 *  `one` nothing can run it. */
function liveOf(v: unknown): { live: ThinkubeLive } | { refused: string } {
  // `live:` written with nothing under it is a block with both fields missing.
  if (v !== null && (typeof v !== "object" || Array.isArray(v)))
    return { refused: "spec.deploy.live must be a mapping with `home` and `one`" };
  const { home, one } = (v ?? {}) as { home?: unknown; one?: unknown };
  const lacks = [
    ...(typeof home === "string" && home.trim() ? [] : ["`home` (the directory of live checks, repository-relative)"]),
    ...(typeof one === "string" && one.trim() ? [] : ["`one` (the command that runs one live check, with <file> for its path)"]),
  ];
  if (lacks.length) return { refused: `spec.deploy.live declares no ${lacks.join(" and no ")}` };
  const h = rootOf((home as string).trim());
  if (path.posix.isAbsolute(h) || h === ".." || h.startsWith("../"))
    return { refused: `spec.deploy.live.home \`${home as string}\` is not inside the repository` };
  if (h === ".")
    return { refused: "spec.deploy.live.home is the repository root — name a directory of its own, such as `live`" };
  if (!(one as string).includes("<file>"))
    return { refused: "spec.deploy.live.one does not contain <file>, so it cannot be told which live check to run" };
  return { live: { home: h, one: (one as string).trim() } };
}

/**
 * How this repository proves itself, when a written check would prove nothing.
 *
 * Some work is declarative. A playbook says a package is installed; a
 * terraform file says a bucket exists. A check asserting that the file says
 * what the file says is testing the tool, not the work — it restates the
 * source in a second language and passes for something that could never run.
 *
 * The tool already knows how to answer. It can be asked to look without
 * changing anything, to do the work, and then to say whether anything is
 * left to do. That last answer is the one no test gives you: a second run
 * that still changes things means the work does not settle, which is a real
 * defect nobody writes a test for.
 *
 * Declared, because the commands belong to the tool and the tool belongs to
 * the repository. Nothing in Tandem knows what ansible or terraform are.
 */
export interface ThinkubeVerify {
  /** Commands that change nothing — lint, syntax, a dry run. */
  still: string[];
  /** The command that does the work. */
  apply?: string;
  /** What to ask afterwards to learn whether anything is left. Often the
   *  same command again; for some tools a different one. */
  ask?: string;
  /** What `ask` must say for the work to have settled. Absent means its
   *  exiting cleanly is the answer. */
  settled?: string;
}

export interface ThinkubeDeclaration {
  /** `app`, `knative`, `component`, or `none` when the platform does not deploy it. */
  deploymentType: string;
  containers: ThinkubeContainer[];
  /** Which container answers at which path of the address. The one that
   *  answers at the root serves the pages a person opens. */
  routes: ThinkubeRoute[];
  /** The trees of a repository with no containers, as declared. */
  parts: ThinkubePart[];
  deploy?: ThinkubeDeploy;
  verify?: ThinkubeVerify;
  /** Where documentation lands, as declared; absent means the default. */
  docsRoot?: string;
  /** `metadata.version`: the release this tree says it is, which its
   *  newest `v` tag must name. */
  version?: string;
}

/** A path as the repository writes it, normalised: "./backend" is "backend", "." stays. */
function rootOf(p: string): string {
  const n = path.posix.normalize(p.replace(/^\.\//, "").replace(/\/$/, ""));
  return n === "" || n === "./" ? "." : n;
}

function testOf(t: { enabled?: boolean; command?: string; image?: string; one?: string } | undefined): ThinkubeTest | undefined {
  if (!t) return undefined;
  return {
    enabled: t.enabled === true,
    ...(t.command ? { command: t.command } : {}),
    ...(t.image ? { image: t.image } : {}),
    ...(typeof t.one === "string" && t.one.trim() ? { one: t.one.trim() } : {}),
  };
}

/**
 * The parts of a declared repository, one toolchain each: the containers
 * of an application by their build directories, or the parts a repository
 * the platform does not deploy declares.
 */
export function partsDeclared(d: ThinkubeDeclaration): ThinkubePart[] {
  if (d.containers.length)
    return d.containers.map((c) => ({ name: c.name, root: rootOf(c.build), ...(c.test ? { test: c.test } : {}) }));
  return d.parts;
}

/** One command or several, written either way — a repository with one step
 *  should not have to write a list to say so. */
function lines(v: unknown): string[] {
  return (Array.isArray(v) ? v : v !== undefined && v !== null ? [v] : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
}

/** The declaration, or undefined when the repository makes none. A file
 *  that exists but cannot be read is a finding, not a silent absence. */
export function thinkubeDeclaration(
  repoRoot: string,
): { declared: ThinkubeDeclaration } | { unreadable: string } | undefined {
  const at = path.join(repoRoot, "thinkube.yaml");
  let raw: string;
  try {
    raw = fs.readFileSync(at, "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT"
      ? undefined
      : { unreadable: `thinkube.yaml exists but could not be read: ${(e as Error).message}` };
  }
  try {
    const doc = parseYaml(raw) as {
      metadata?: { version?: unknown };
      spec?: {
        deployment?: { type?: string };
        parts?: { name?: string; root?: string; test?: { enabled?: boolean; command?: string; image?: string; one?: string } }[];
        docs?: { root?: unknown };
        deploy?: { run?: unknown; in?: unknown; at?: unknown; live?: unknown };
        verify?: { still?: unknown; apply?: unknown; ask?: unknown; settled?: unknown };
        containers?: {
          name?: string;
          build?: string;
          test?: { enabled?: boolean; command?: string; image?: string; one?: string };
          health?: unknown;
        }[];
        routes?: { path?: string; to?: string }[];
      };
    };
    const containers = (doc?.spec?.containers ?? [])
      .filter((c) => typeof c?.name === "string" && typeof c?.build === "string")
      .map((c) => {
        const test = testOf(c.test);
        const health = typeof c.health === "string" && c.health.trim() ? c.health.trim() : undefined;
        return { name: c.name as string, build: c.build as string, ...(test ? { test } : {}), ...(health ? { health } : {}) };
      });
    const routes: ThinkubeRoute[] = (doc?.spec?.routes ?? [])
      .filter((r) => typeof r?.path === "string" && typeof r?.to === "string")
      .map((r) => ({ path: r.path as string, to: r.to as string }));
    const parts: ThinkubePart[] = (doc?.spec?.parts ?? [])
      .filter((p) => typeof p?.name === "string" && typeof p?.root === "string")
      .map((p) => {
        const test = testOf(p.test);
        return { name: p.name as string, root: rootOf(p.root as string), ...(test ? { test } : {}) };
      });
    const docsRoot =
      typeof doc?.spec?.docs?.root === "string" && doc.spec.docs.root.trim() ? rootOf(doc.spec.docs.root) : undefined;
    const d = doc?.spec?.deploy;
    const run = lines(d?.run);
    const live = d && Object.prototype.hasOwnProperty.call(d, "live") ? liveOf(d.live) : undefined;
    if (live && "refused" in live) return { unreadable: `thinkube.yaml ${live.refused}` };
    if (live && !(typeof d?.at === "string" && d.at.trim()))
      return { unreadable: "thinkube.yaml spec.deploy.live needs spec.deploy.at, the address its live checks run against" };
    const deploy: ThinkubeDeploy | undefined = d
      ? {
          run,
          ...(typeof d.in === "string" && d.in.trim() ? { in: d.in.trim() } : {}),
          ...(typeof d.at === "string" && d.at.trim() ? { at: d.at.trim() } : {}),
          ...(live ? { live: live.live } : {}),
        }
      : undefined;
    const declaredVersion = doc?.metadata?.version;
    const version =
      typeof declaredVersion === "string" && declaredVersion.trim()
        ? declaredVersion.trim()
        : typeof declaredVersion === "number"
          ? String(declaredVersion)
          : undefined;
    const v = doc?.spec?.verify;
    const verify: ThinkubeVerify | undefined = v
      ? {
          still: lines(v.still),
          ...(typeof v.apply === "string" && v.apply.trim() ? { apply: v.apply.trim() } : {}),
          ...(typeof v.ask === "string" && v.ask.trim() ? { ask: v.ask.trim() } : {}),
          ...(typeof v.settled === "string" && v.settled.trim() ? { settled: v.settled.trim() } : {}),
        }
      : undefined;
    return {
      declared: {
        deploymentType: doc?.spec?.deployment?.type ?? "app",
        containers,
        routes,
        parts,
        ...(deploy ? { deploy } : {}),
        ...(verify ? { verify } : {}),
        ...(docsRoot ? { docsRoot } : {}),
        ...(version ? { version } : {}),
      },
    };
  } catch (e) {
    return { unreadable: `thinkube.yaml exists but does not parse: ${(e as Error).message}` };
  }
}

/**
 * Whether the platform's pipeline builds this repository's images: it
 * declares containers, and each push builds and tests them in the cluster
 * with the resources the declaration names. Such a repository's product is
 * judged by that pipeline, never by a build run beside the editor. A
 * declaration that cannot be read throws in its own words.
 */
export function imagesBuiltByPlatform(repoRoot: string): boolean {
  const read = thinkubeDeclaration(repoRoot);
  if (!read) return false;
  if ("unreadable" in read) throw new Error(read.unreadable);
  return read.declared.containers.length > 0;
}
