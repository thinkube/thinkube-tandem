/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a repository is ready for work to be signed against it.
 *
 * A run refuses or misbehaves for things that are true of the repository
 * before anything is signed: a setup command that does not hold on a clean
 * copy, checks minted where the suite never runs them, a template that
 * declares no deploy, a release tag the platform will not accept, secrets
 * the manifest names and control does not hold, a deploy that does not go
 * live. Each of those costs a signed run to discover after the fact. Asked
 * here, it costs one check, and the person reads what to fix before the
 * press that cannot be undone.
 *
 * Each item answers `ready`, and `say` tells a person what is wrong and
 * what to do. The answer is kept in the store, beside the repository's
 * spaces, per checkout, HEAD commit and the content of the three files it
 * reads (`thinkube.yaml`, `manifest.yaml`, `.tandem/setup.json`). Asking
 * twice about the same tree runs neither the setup nor a deploy again, and
 * every process that reads the store — the editor, the MCP server, a run's
 * driver — reads the same answer. Only what the tree decides is reused
 * that way: an item that depends on something outside it — the secrets
 * Thinkube Control holds, the tags on origin, whether a deploy goes live —
 * or whose check could not run is asked again until it is ready.
 */
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { spacesHome } from "../core/spaces";
import { partsDeclared, thinkubeDeclaration } from "../core/thinkubeYaml";
import { controlReachedBy, type Http } from "../hostui/templateCore";
import { isCodePath, rehouseChecks, unreachableCheckHomes } from "./checkHomes";
import { haltableExecs } from "./execs";
import { factsOf } from "./facts";
import type { Invoke } from "./makeLive";
import { defaultExec, runnerEnv, type Exec } from "./oracle";
import { missing } from "./proved";
import { declaredBuildPassed } from "./buildWords";
import { openTheDoor, type BoundedExec } from "./setup";
import { downstreamOf } from "./survey";
import { headOf, validationDeploy, type ReachControl } from "./validationDeploy";
import { canJudgeOne, knownUnderDeclaration, toldByDeclaration } from "./whatWeKnow";

interface ReadinessItem {
  name: string;
  ready: boolean;
  /** What is wrong and what to do, for a person; what was found, when ready. */
  say: string;
  /** The item's own check failed to run, so this is no answer about the tree. */
  unchecked?: true;
}

/** Items whose answer the tree under the key decides alone. */
const DECIDED_BY_THE_TREE = new Set(["setup", "check homes", "deploy declared"]);

/** What a kept answer still says for the tree it was asked about: every
 *  ready item, and every not-ready item the tree alone decides. */
function stillAnswered(kept: Readiness): Map<string, ReadinessItem> {
  return new Map(
    kept.items.filter((i) => i.ready || (DECIDED_BY_THE_TREE.has(i.name) && !i.unchecked)).map((i) => [i.name, i]),
  );
}

export interface Readiness {
  repoRoot: string;
  /** The commit the answer is about. */
  head: string;
  /** When it was answered. */
  at: string;
  items: ReadinessItem[];
}

/** Where a repository's answers are kept: the store, beside its spaces. */
interface ReadinessHome {
  storeRoot: string;
  /** The repository's minted id, from its card. */
  repoId: string;
}

interface ReadinessArgs {
  repoRoot: string;
  home: ReadinessHome;
  /** git, and the door's own listing. */
  exec?: Exec;
  /** The door's commands: install, build, one test. */
  boundedExec?: BoundedExec;
  /** The declared deploy's commands. */
  invoke?: Invoke;
  /** Control's secrets, and the deployed health path. */
  http?: Http;
  control?: ReachControl;
  wait?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
  now?: () => string;
}

const asking = new Map<string, Promise<Readiness>>();

/** The files whose content decides the answer, beside the HEAD commit. */
const READ = ["thinkube.yaml", "manifest.yaml", path.join(".tandem", "setup.json")];

function keyOf(root: string, head: string): string {
  const h = crypto.createHash("sha256").update(`${root}\0${head}`);
  for (const f of READ) {
    const at = path.join(root, f);
    h.update(`\0${f}\0`).update(fs.existsSync(at) ? fs.readFileSync(at) : "(absent)");
  }
  return h.digest("hex");
}

/** The file one answer is kept in. */
function keptAt(home: ReadinessHome, key: string): string {
  return path.join(spacesHome(home.storeRoot, home.repoId, "repository"), `readiness-${key}.json`);
}

/** The answer kept for this key, if one was given. A kept answer that
 *  cannot be parsed throws, naming the file. */
function readKept(home: ReadinessHome, key: string): Readiness | undefined {
  const at = keptAt(home, key);
  if (!fs.existsSync(at)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(at, "utf8")) as Readiness;
  } catch (e) {
    throw new Error(`the readiness answer kept at ${at} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Keep an answer, written whole: a reader never sees half a file. */
function keep(home: ReadinessHome, key: string, result: Readiness): void {
  const at = keptAt(home, key);
  fs.mkdirSync(path.dirname(at), { recursive: true });
  const tmp = `${at}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(result, null, 2) + "\n");
  fs.renameSync(tmp, at);
}

/** The commit a checkout's HEAD names, read synchronously, for a reader
 *  that renders. A HEAD git cannot name throws in git's words. */
function headNow(root: string): string {
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error(`git could not name HEAD in ${root}: ${head.slice(0, 300)}`);
  return head;
}

/** The answer the store keeps for this checkout at the HEAD it stands at
 *  now, given by whichever process asked; nothing when that tree was never
 *  answered. */
export function readinessNow(
  home: ReadinessHome,
  repoRoot: string,
  head: (root: string) => string = headNow,
): Readiness | undefined {
  const root = path.resolve(repoRoot);
  return readKept(home, keyOf(root, head(root)));
}

/** Why work cannot be signed against these repositories, or nothing when
 *  every item of every one is ready. */
export function readinessRefusal(all: readonly Readiness[]): string | undefined {
  const blocked = all.filter((r) => r.items.some((i) => !i.ready));
  if (!blocked.length) return undefined;
  return (
    "not ready to sign — " +
    blocked
      .map(
        (r) =>
          (all.length > 1 ? `${r.repoRoot}: ` : "") +
          r.items
            .filter((i) => !i.ready)
            .map((i) => `${i.name}: ${i.say}`)
            .join(" · "),
      )
      .join(" · ")
  );
}

/** The readiness of one repository, from the store when its HEAD and its
 *  declarations are what they were when it was last answered. */
export async function checkReadiness(a: ReadinessArgs): Promise<Readiness> {
  const root = path.resolve(a.repoRoot);
  const exec = a.exec ?? defaultExec;
  const head = await headOf(root, exec);
  const key = keyOf(root, head);
  const kept = readKept(a.home, key);
  const still = kept ? stillAnswered(kept) : new Map<string, ReadinessItem>();
  if (kept && kept.items.every((i) => still.has(i.name))) return kept;
  const flying = asking.get(`${root}\0${key}`);
  if (flying) return flying;
  const asked = answer({ ...a, repoRoot: root, exec }, head, still).then((result) => {
    // Kept under the HEAD it was asked about. A deploy that commits a
    // release moves HEAD, so a question about the new commit is a new
    // question: its tree is answered again, and its deploy is not run
    // again because that commit is recorded as deployed.
    keep(a.home, key, result);
    return result;
  });
  asking.set(`${root}\0${key}`, asked);
  try {
    return await asked;
  } finally {
    asking.delete(`${root}\0${key}`);
  }
}

async function answer(
  a: ReadinessArgs & { exec: Exec },
  head: string,
  answered: ReadonlyMap<string, ReadinessItem>,
): Promise<Readiness> {
  const root = a.repoRoot;
  const template = downstreamOf(root) === "template";
  const items: ReadinessItem[] = [];
  const attempt = async (name: string, check: () => Promise<Omit<ReadinessItem, "name">>): Promise<ReadinessItem> =>
    answered.get(name) ?? checkItem(name, check);
  items.push(await attempt("setup", () => setupHolds(a, head, template)));
  items.push(await attempt("check homes", () => checksLandWhereTestsRun(root, a.exec)));
  if (template) {
    items.push(await attempt("deploy declared", async () => deployDeclared(root)));
    items.push(await attempt("release", () => releaseTagged(root, a.exec)));
  }
  if (fs.existsSync(path.join(root, "manifest.yaml")))
    items.push(await attempt("secrets", () => secretsHeld(root, a)));
  if (template) {
    const waitsOn = items.filter((i) => !i.ready && ["deploy declared", "release", "secrets"].includes(i.name));
    items.push(
      waitsOn.length
        ? {
            name: "deploy works",
            ready: false,
            say: `not tried while ${waitsOn.map((i) => i.name).join(", ")} ${waitsOn.length === 1 ? "is" : "are"} not ready — the platform would refuse the deploy for that alone`,
          }
        : await attempt("deploy works", () => deployWorks(a, head)),
    );
  }
  return { repoRoot: root, head, at: (a.now ?? (() => new Date().toISOString()))(), items };
}

/** An item whose own check failed to run is not ready, in the failure's words. */
async function checkItem(name: string, check: () => Promise<Omit<ReadinessItem, "name">>): Promise<ReadinessItem> {
  try {
    return { name, ...(await check()) };
  } catch (e) {
    return { name, ready: false, say: `could not be checked: ${e instanceof Error ? e.message : String(e)}`, unchecked: true };
  }
}

/**
 * The repository's setup commands, run by the door on an untouched copy of
 * HEAD, exactly as a run's first minute runs them — with what the
 * repository declares and what an earlier run proved about it.
 */
async function setupHolds(
  a: ReadinessArgs & { exec: Exec },
  head: string,
  template: boolean,
): Promise<Omit<ReadinessItem, "name">> {
  const root = a.repoRoot;
  const short = head.slice(0, 8);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ready-"));
  const added = await a.exec("git", ["-C", root, "worktree", "add", "--detach", copy, head], root);
  if (added.code !== 0) {
    fs.rmSync(copy, { recursive: true, force: true });
    throw new Error(`a clean copy of ${short} could not be made: ${added.out.trim().slice(0, 300)}`);
  }
  let found: Omit<ReadinessItem, "name">;
  try {
    // What the repository declares wins over what an earlier run proved,
    // as in a run: each part's own command, and the whole repository's
    // when a part is built from ".".
    const declared = toldByDeclaration(root);
    const known = knownUnderDeclaration(factsOf(root), declared.suite);
    const told = {
      ...(known?.provision ? { provision: known.provision } : {}),
      ...(known?.prepare ? { prepare: known.prepare } : {}),
      ...(known?.build ? { build: known.build } : {}),
      ...(known?.runOne ? { runOne: known.runOne } : {}),
      ...(known?.suite ? { suite: known.suite } : {}),
      ...declared,
    };
    const ready = await openTheDoor({
      worktree: copy,
      repoRoot: root,
      tep: "readiness",
      ...(known ? { known } : {}),
      told,
      exec: a.exec,
      boundedExec: a.boundedExec ?? haltableExecs(() => false, runnerEnv()).boundedExec,
      log: (l) => a.log?.(l),
      defect: () => {
        throw new Error("the readiness check never mends a tree, so it records no repair");
      },
      resumed: false,
      halted: () => false,
    });
    found = ready.refusal
      ? { ready: false, say: `on an untouched copy of ${short}, ${ready.refusal}` }
      : !canJudgeOne(ready, told)
        ? { ready: false, say: missing("runOne") }
        : {
            ready: true,
            say:
              `the setup holds on an untouched copy of ${short}` +
              (ready.build ? `, and ${declaredBuildPassed(ready.build, template)}` : "") +
              (ready.runOne ? `, and one test runs with: ${ready.runOne}` : ""),
          };
  } finally {
    const removed = await a.exec("git", ["-C", root, "worktree", "remove", "--force", copy], root);
    if (removed.code !== 0) a.log?.(`the trial copy at ${copy} could not be removed: ${removed.out.trim().slice(0, 300)}`);
    if (fs.existsSync(copy) && !fs.readdirSync(copy).length) fs.rmdirSync(copy);
  }
  return found;
}

/**
 * The file a check would be minted beside: code in the language most of
 * the code is written in, nearest the root.
 *
 * A repository that declares parts is read inside them: the parts other
 * than "." when it has any, else the whole repository a "." part is. Code
 * outside every part — a script that lints the documentation — is not
 * where its work lands, and judging the repository by it refuses a
 * repository whose parts are ready.
 */
function representative(files: readonly string[], partRoots: readonly string[] = []): string | undefined {
  const owned = partRoots.filter((r) => r !== ".");
  const within = owned.length
    ? files.filter((f) => owned.some((r) => f === r || f.startsWith(`${r}/`)))
    : files;
  const code = within.filter(isCodePath);
  const ext = (f: string): string => path.extname(f).toLowerCase();
  const counted = new Map<string, number>();
  for (const f of code) counted.set(ext(f), (counted.get(ext(f)) ?? 0) + 1);
  const most = [...counted.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
  return code
    .filter((f) => ext(f) === most)
    .sort((x, y) => x.split("/").length - y.split("/").length || x.localeCompare(y))[0];
}

/**
 * Where a check minted for this repository's code would land, and whether
 * the repository's suite runs tests there — the same placement and the
 * same refusal a run makes before dispatch.
 */
async function checksLandWhereTestsRun(root: string, exec: Exec): Promise<Omit<ReadinessItem, "name">> {
  const listed = await exec("git", ["-C", root, "ls-files"], root);
  if (listed.code !== 0) throw new Error(`git could not list the repository's files: ${listed.out.trim().slice(0, 300)}`);
  const repoFiles = listed.out.split("\n").map((l) => l.trim()).filter(Boolean);
  const declared = thinkubeDeclaration(root);
  const parts = declared && "declared" in declared ? partsDeclared(declared.declared) : [];
  const subject = representative(repoFiles, parts.map((p) => p.root));
  if (!subject)
    return {
      ready: true,
      say: `${parts.some((p) => p.root !== ".") ? "the declared parts hold" : "the repository holds"} no code file, so no check is minted beside code`,
    };
  const slices = [
    {
      handle: "readiness",
      workUnits: [
        { role: "code", footprint: [subject] },
        { role: "test", footprint: ["probes/readiness__SL-1_AC-1.test.mjs"] },
      ],
    },
  ];
  rehouseChecks(slices, repoFiles, new Set(), parts);
  const minted = slices[0].workUnits[1].footprint[0];
  const stranded = unreachableCheckHomes(slices, repoFiles, parts);
  if (stranded.where.length)
    return {
      ready: false,
      say:
        `a check for ${subject} would be minted at ${minted}, where this repository runs no test of its own — ` +
        `its tests live under ${stranded.roots.join(", ")}. Keep a test of the repository's own in the tree that ` +
        `holds its code, or declare that tree as a part in thinkube.yaml.`,
    };
  return {
    ready: true,
    say: stranded.roots.length
      ? `a check for ${subject} is minted at ${minted}, where the repository runs its tests (${stranded.roots.join(", ")})`
      : `the repository keeps no test yet; a check for ${subject} is minted at ${minted}, as its first`,
  };
}

/** A template is proved by deploying it, so it must say how and where. */
function deployDeclared(root: string): Omit<ReadinessItem, "name"> {
  const read = thinkubeDeclaration(root);
  if (!read) return { ready: false, say: "there is no thinkube.yaml — a template declares itself there" };
  if ("unreadable" in read) return { ready: false, say: read.unreadable };
  const d = read.declared.deploy;
  const lacks = [...(d?.run.length ? [] : ["`run` (the commands that deploy it)"]), ...(d?.at ? [] : ["`at` (the address it answers at)"])];
  return lacks.length
    ? {
        ready: false,
        say: `thinkube.yaml spec.deploy does not declare ${lacks.join(" or ")} — declare both, so the work can be deployed and looked at after the merge`,
      }
    : { ready: true, say: `deployed by ${d!.run.join(" && ")}, seen at ${d!.at}` };
}

/** The platform deploys a template's released version, so the newest
 *  release tag on origin must be the version the tree says it is. */
async function releaseTagged(root: string, exec: Exec): Promise<Omit<ReadinessItem, "name">> {
  const read = thinkubeDeclaration(root);
  const version = read && "declared" in read ? read.declared.version : undefined;
  if (!version) return { ready: false, say: "thinkube.yaml declares no metadata.version — declare the release this tree is" };
  const r = await exec("git", ["-C", root, "ls-remote", "--tags", "--refs", "origin"], root);
  if (r.code !== 0) throw new Error(`git could not read origin's tags: ${r.out.trim().slice(0, 300)}`);
  const tags = [...r.out.matchAll(/refs\/tags\/v(\d+)\.(\d+)\.(\d+)$/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  if (!tags.length)
    return { ready: false, say: `origin has no vMAJOR.MINOR.PATCH tag — tag the release v${version} and push the tag` };
  const [M, m, p] = tags.sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0];
  const newest = `v${M}.${m}.${p}`;
  return newest === `v${version}`
    ? { ready: true, say: `origin's newest release tag is ${newest}, the version thinkube.yaml declares` }
    : {
        ready: false,
        say: `origin's newest release tag is ${newest}, but thinkube.yaml metadata.version is ${version} — make them name the same release`,
      };
}

/** Every secret the manifest declares, held by Thinkube Control. */
async function secretsHeld(root: string, a: ReadinessArgs): Promise<Omit<ReadinessItem, "name">> {
  const manifest = parseYaml(fs.readFileSync(path.join(root, "manifest.yaml"), "utf8")) as { secrets?: unknown } | null;
  const declared = (Array.isArray(manifest?.secrets) ? manifest!.secrets : [])
    .map((s: unknown) => (typeof s === "string" ? s : (s as { name?: unknown } | null)?.name))
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  if (!declared.length) return { ready: true, say: "manifest.yaml declares no secrets" };
  const reach = (a.control ?? controlReachedBy)();
  if ("reason" in reach)
    return { ready: false, say: `thinkube-control cannot be asked whether ${declared.join(", ")} exist: ${reach.reason}` };
  const res = await (a.http ?? fetch)(`${reach.base}/api/v1/secrets/`, {
    headers: { Authorization: `Bearer ${reach.token}` },
  });
  if (!res.ok) return { ready: false, say: `thinkube-control answered ${res.status} when asked for its secrets` };
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return { ready: false, say: "thinkube-control's answer for its secrets is not a list" };
  const held = new Set(body.map((s: unknown) => (s as { name?: unknown } | null)?.name).filter((n) => typeof n === "string"));
  const lacking = declared.filter((n) => !held.has(n));
  return lacking.length
    ? {
        ready: false,
        say: `thinkube-control holds no secret named ${lacking.join(", ")}, which manifest.yaml declares — create ${lacking.length === 1 ? "it" : "them"} in Thinkube Control's Secrets`,
      }
    : { ready: true, say: `thinkube-control holds ${declared.join(", ")}` };
}

/** The declared deploy, run once for this commit, and seen answering. */
async function deployWorks(a: ReadinessArgs, head: string): Promise<Omit<ReadinessItem, "name">> {
  const v = await validationDeploy({
    repoRoot: a.repoRoot,
    head,
    ...(a.exec ? { exec: a.exec } : {}),
    ...(a.invoke ? { invoke: a.invoke } : {}),
    ...(a.http ? { http: a.http } : {}),
    ...(a.control ? { control: a.control } : {}),
    ...(a.wait ? { wait: a.wait } : {}),
    ...(a.log ? { log: a.log } : {}),
  });
  if (v.ok)
    return {
      ready: true,
      say:
        `${v.deployed ? "deployed" : "already deployed"} ${v.head.slice(0, 8)}` +
        (v.head !== head ? ` (the deploy moved HEAD from ${head.slice(0, 8)})` : "") +
        `, and ${v.url} answered`,
    };
  return {
    ready: false,
    say:
      v.stage === "declaration"
        ? `${v.why} — declare it in thinkube.yaml`
        : v.stage === "deploy"
          ? `the declared deploy failed — fix it and ask again:\n${v.why}`
          : `the deploy ran, but ${v.why}`,
  };
}
