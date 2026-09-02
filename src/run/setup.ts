/**
 * Making a run's trees ready to build and check.
 *
 * A worktree fresh from `git worktree add` is a bare checkout: whatever a
 * developer's clone accumulated — installed dependencies, toolchains — is
 * not there, so a build step that is right for the repository fails on
 * "not installed", every verify reports a build failure that no worker
 * can turn green, and the coder grinds against the environment.
 *
 * So the code worktree is PROVISIONED once, with the command the machine
 * derived from the repository's manifests, and what that command produced
 * is OBSERVED — the ignored entries that appeared — rather than named:
 * nothing here knows any package manager. Those entries are then linked
 * into every verify runner (a runner is a snapshot of the same branch), so
 * one install serves the whole run.
 *
 * When the checkout the run was started from ALREADY HOLDS what
 * provisioning would produce, the run BORROWS it — the same links, from
 * the base — and skips the command. A machine with little memory dies
 * during an install it did not need, which is how two runs ended before
 * their first worker. Borrowing is checked immediately, because the build
 * is proved right after: if the build then fails, the borrowed state is
 * dropped and the real command runs, so a stale borrow costs one build and
 * never a wrong run.
 *
 * Then the build step is PROVED on the untouched tree: if it fails before
 * any worker has changed a line, the fault is the environment's, and the
 * run is refused with the output — never dispatched into a wall. The
 * repository's own suite is judged once, at the gate.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Exec } from "./oracle";
import { isProbePath, isTestPath } from "./testHomes";
import { releaseBorrowed, removeOwned } from "./ownTree";
import { askForTheSuite, proveSuite } from "./suiteCommand";
import { proved, type Proved } from "./proved";
import { linkProvisioned } from "./linkProvisioned";
import { tail } from "./toolWords";
import { repairStandingTree } from "./refresh";

export type BoundedExec = (
  cmd: string,
  cwd: string,
) => Promise<{ code: number | null; output: string }>;

/**
 * What a run may borrow instead of installing again is MEASURED wherever
 * it can be.
 *
 * A list of ecosystem names — node_modules, venv, Pods — is a list of the
 * ecosystems somebody thought of. A project whose store is called anything
 * else matched nothing: it installed from scratch every run, and every
 * runner worktree was built with no dependencies, so each check died with
 * the tool's own words and the failure read as the code's. Silent, and
 * permanent, in every language but the one the list was written for.
 *
 * The repository's own provisioning command says what it makes. Run it
 * once, see what appeared, remember that — and the answer is right in
 * Python, Go, Rust and Ruby with nobody maintaining anything.
 */

/** Ignored entries at the tree's surface (`!! node_modules/`), collapsed —
 *  never one line per installed file. */
async function ignoredEntries(dir: string, exec: Exec): Promise<Set<string>> {
  const r = await exec("git", ["-C", dir, "status", "--porcelain", "--ignored"], dir);
  return new Set(
    r.out
      .split("\n")
      .filter((l) => l.startsWith("!! "))
      .map((l) => l.slice(3).trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

export interface TreeSetup {
  /** Ran one of this repository's own tests here; absent when nothing held. */
  runOne?: Proved;
  /**
   * Per PART, where a part answers differently — keyed by the part's
   * repository-relative root. A check is run by the command of the part
   * that owns it: pytest for the backend, a node runner for the frontend.
   * One command for a repository with two toolchains ran the wrong runner
   * for every part but one, and the resulting red said nothing any worker
   * could act on.
   */
  parts?: Record<string, { provision?: string; prepare?: string; runOne?: string }>;
  /** Ran this repository's whole suite here; absent when nothing held. */
  suite?: Proved;
  /** Provisioned this tree here; absent when the repository needs none. */
  provision?: Proved;
  /** Built this tree here so a check could run; absent when none is needed. */
  prepare?: Proved;
  /** Built the product here as this repository ships it; absent when it
   *  ships nothing built — which removes one of the run's two vetoes, and
   *  is why the door says so out loud rather than leaving it to silence. */
  build?: Proved;
  /** What provisioning produced — ignored entries to link into runners. */
  provisioned: string[];
  /** What the build step produced — where compiled output lands, so a
   *  tester imports from a folder that exists. */
  built: string[];
  /** Why the run cannot proceed, when the untouched tree fails its own setup. */
  refusal?: string;
  /** The setup that finally held, when a first answer had to be corrected. */
  corrected?: { provision: string; prepare: string };
}

export interface SetupArgs {
  worktree: string;
  /** The checkout the run was started from, whose provisioning can be
   *  borrowed instead of installed again. */
  repoRoot?: string;
  provision?: string;
  prepare?: string;
  /** Builds the product as shipped. Proved on the untouched tree like the
   *  build step: a tree that does not ship before any worker touches it is
   *  the environment's failure, refused with the compiler's words. */
  build?: string;
  /** Runs one of the repository's own test files (`<file>` = its source
   *  path). Proved on one existing test before it is trusted; an answer
   *  that does not hold is dropped, never a reason to refuse the run. */
  runOne?: string;
  /** Re-read the setup facts with a failure as evidence; the door tries the
   *  corrected answer once before refusing. */
  resetup?: (
    evidence: string,
  ) => Promise<{ provision: string; prepare: string; runOne?: string; suite?: string }>;
  /** What this repository's build step produces, when it has been proved
   *  here before — never borrowed, because output is the work judged. */
  builds?: string[];
  /**
   * What this repository's INSTALL command was watched producing, in an
   * earlier run here. The only thing a run may borrow.
   *
   * Absent on a repository nobody has installed here: nothing is lent, the
   * run installs, and what appears is watched and remembered. One slow run
   * buys an answer that is right in every language, because the repository
   * answered it by running its own command.
   */
  dependencies?: string[];
  /** How this repository runs its whole suite. */
  suite?: string;
  /** The parts this project is made of, and what each was told. The door
   *  proves each part's own single-check command in that part's tree. */
  partCommands?: Record<string, { provision?: string; prepare?: string; runOne?: string }>;
  /**
   * This repository already proved that suite command, in an earlier run.
   *
   * Proving it means RUNNING it, which costs the length of a suite at the
   * start of every run — paid again and again for an answer that did not
   * change. A remembered answer is taken as it stands; if it turns out not
   * to run, the gate says the command did not run rather than that the
   * work is red, which is the attribution the proving was there to buy.
   */
  suiteProvenBefore?: boolean;
  /** Told the answer that held on the untouched tree — the only one worth remembering. */
  proven?: (s: { provision: string; prepare: string; runOne: string }) => void;
  exec: Exec;
  boundedExec: BoundedExec;
  log: (line: string) => void;
}

/** Provision the tree and prove the build and the suite on it before any
 *  worker runs; a setup answer that fails is re-read once with the failure
 *  as evidence, and the corrected answer is tried before the run refuses. */
export async function setupRunTree(args: SetupArgs): Promise<TreeSetup> {
  let borrowed = false;
  const first = await proveTree({
    ...args,
    log: (l) => {
      if (/^borrowing the checkout's/.test(l)) borrowed = true;
      args.log(l);
    },
  });
  if (!first.refusal) {
    args.proven?.({ provision: args.provision ?? "", prepare: args.prepare ?? "", runOne: first.runOne ?? "" });
    return first;
  }
  // A borrowed store that does not build is the borrow's failure, not the
  // repository's: the remembered install is run instead, at once. Asking a
  // model to correct a provisioning that was never tried cost five silent
  // minutes a run, to arrive at the answer already on file.
  if (borrowed && args.provision) {
    args.log(`the borrowed dependencies did not build — installing instead: ${args.provision}`);
    const own = await proveTree(args, false);
    if (!own.refusal) {
      args.proven?.({ provision: args.provision, prepare: args.prepare ?? "", runOne: own.runOne ?? "" });
      return own;
    }
    if (!args.resetup) return own;
    return await correctAndRetry(args, own);
  }
  if (!args.resetup) return first;
  return await correctAndRetry(args, first);
}

/** The setup answer re-read once with the failure as evidence, and the corrected answer tried. */
async function correctAndRetry(args: SetupArgs, first: TreeSetup): Promise<TreeSetup> {
  args.log(`asking how this tree is provisioned, from the failure — this takes a few minutes`);
  const again = await args.resetup!(first.refusal!).catch(() => undefined);
  if (!again || (again.provision === (args.provision ?? "") && again.prepare === (args.prepare ?? "")))
    return first;
  args.log(
    `the setup answer was corrected from the failure — provision: ${again.provision || "NONE"}; prepare: ${again.prepare || "NONE"}`,
  );
  const second = await proveTree({ ...args, provision: again.provision, prepare: again.prepare, runOne: again.runOne ?? args.runOne });
  if (!second.refusal)
    args.proven?.({ provision: again.provision, prepare: again.prepare, runOne: second.runOne ?? "" });
  return second.refusal ? second : { ...second, corrected: { provision: again.provision, prepare: again.prepare } };
}

/** Seconds since a moment, for a door that must say how long each step took. */
const since = (t0: number): string => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function proveTree(args: SetupArgs, borrow = true): Promise<TreeSetup> {
  const provisioned: string[] = [];
  if (!args.provision && !args.prepare && !args.runOne && !args.build)
    args.log(
      "⚠ no setup facts for this repository — nothing is installed or built before the checks run. " +
        "If the checks need a build, every one of them will fail for that alone: the reading should be repeated, or the facts given.",
    );
  let borrowed = false;
  // Borrowing does not wait for a known install command: the checkout the
  // run was started from holds the ground truth about what a ready tree
  // has, and a repository whose install command was never learned still
  // deserves a tree that builds. The build proof right after guards it.
  if (borrow && args.repoRoot) {
    const theirs = await ignoredEntries(args.repoRoot, args.exec);
    const mine = await ignoredEntries(args.worktree, args.exec);
    // What the checkout ignores and this tree lacks — MINUS whatever this
    // repository's own build step is known to produce.
    //
    // Dependencies may be shared: they are the same for everyone. Build
    // output may not: it is the work being judged, and a run that borrows
    // it compiles through a doorway into the other tree and grades that
    // tree's code. Seven reds against finished work came from lending
    // out-test/ once.
    //
    // Only what THIS repository's own install command was watched
    // producing. Nothing else, whatever it is called.
    //
    // It used to be the other way round: lend everything the repository
    // ignores, minus what a build was seen making. That is a denylist, and
    // a denylist is incomplete by construction — `out` was lent because
    // nobody had watched the product build, and the run then compiled
    // through the link into the directory the extension is deployed from.
    // `media` and a handful of `.vsix` files went the same way; no install
    // made either of them.
    //
    // Nothing remembered means nothing lent: the run pays for one install
    // and watches what appears, which is how the answer is learned in the
    // first place. Slow and correct beats fast and silently wrong.
    const dependencies = new Set(args.dependencies ?? []);
    const lendable = [...theirs].filter((e) => !mine.has(e) && dependencies.has(e));
    if (lendable.length) {
      await linkProvisioned(args.worktree, args.repoRoot, lendable);
      provisioned.push(...lendable);
      borrowed = true;
      args.log(
        `borrowing the checkout's ${lendable.slice(0, 6).join(", ")}${lendable.length > 6 ? "…" : ""}` +
          (args.provision ? ` instead of running: ${args.provision}` : ""),
      );
    }
  }
  if (args.provision && !borrowed) {
    // NEVER install into a borrowed store: an installer deletes the store
    // before filling it, and a borrowed store is a doorway into the
    // checkout — so the delete lands in the person's own tree. It happened.
    const freed = await releaseBorrowed(args.worktree, [
      ...(await ignoredEntries(args.worktree, args.exec)),
    ]);
    for (const rel of freed)
      args.log(`  released the borrowed ${rel} — installing into it would have emptied the lender`);
    const before = await ignoredEntries(args.worktree, args.exec);
    args.log(`provisioning the worktree: ${args.provision}`);
    const t0 = Date.now();
    const p = await args.boundedExec(args.provision, args.worktree);
    args.log(`  provisioned in ${since(t0)}`);
    if (p.code !== 0)
      return {
        provisioned,
        built: [],
        refusal: `the repository's own provisioning step (${args.provision}) fails on an untouched checkout — no worker can build here until it does:\n${tail(p.output)}`,
      };
    const after = await ignoredEntries(args.worktree, args.exec);
    for (const e of after) if (!before.has(e)) provisioned.push(e);
  }
  // What a READY TREE HAS, never a diff of what this call changed.
  //
  // Every runner worktree is given these by linkProvisioned, so the list
  // must mean "what a runner needs", whatever this call did. Derived as a
  // before/after diff, one swallowed failure upstream put a store on both
  // sides and the list came back empty — no fresh runner was linked, its
  // build died in an empty tree, and the failure was pinned on the code.
  //
  // What a runner needs is what the INSTALL made — here, or in an earlier
  // run of this repository. Sweeping in everything the tree ignores put
  // build output and stray packages on the list too, and a runner was
  // linked to both.
  for (const e of await ignoredEntries(args.worktree, args.exec))
    if ((args.dependencies ?? []).includes(e) && !provisioned.includes(e)) provisioned.push(e);
  const built: string[] = [];
  if (args.prepare) {
    const before = await ignoredEntries(args.worktree, args.exec);
    args.log(`building the untouched tree: ${args.prepare}`);
    const t0 = Date.now();
    const b = await args.boundedExec(args.prepare, args.worktree);
    args.log(`  built in ${since(t0)}`);
    if (b.code !== 0) {
      // A borrowed provisioning that does not build is simply wrong for
      // this tree: drop it and pay for the real install once.
      if (borrowed) {
        args.log("  the borrowed provisioning does not build here — installing instead");
        // One rule decides what may be destroyed: a doorway is unlinked, a
        // directory of the run's own is removed whole, anything outside is
        // refused and said. A plain force-rm threw EISDIR on a directory
        // and the swallowed throw left the store in place.
        for (const rel of provisioned) {
          const r = await removeOwned(args.worktree, path.join(args.worktree, rel));
          if (r.refused) args.log(`  ${r.refused}`);
        }
        return proveTree(args, false);
      }
      return {
        provisioned,
        built,
        refusal: `the repository's own build step (${args.prepare}) fails on the untouched tree — every check would report a build failure no worker can fix:\n${tail(b.output)}`,
      };
    }
    const after = await ignoredEntries(args.worktree, args.exec);
    for (const e of after) if (!before.has(e) && !provisioned.includes(e)) built.push(e);
    if (built.length) args.log(`  the build emits into: ${built.join(", ")}`);
  }
  // Nothing the door lent or watched appear may ever be staged: the gate,
  // the closer and every slice commit run `git add -A` in this tree.
  await excludeFromGit(args.worktree, [...provisioned, ...built], args.exec);
  if (args.build) {
    // Watched exactly like the test build. It was not, so what the PRODUCT
    // build makes was never on the list of things a run must not lend —
    // and `out` was lent to a run, which then compiled through the link
    // into the directory the extension is deployed from.
    const before = await ignoredEntries(args.worktree, args.exec);
    args.log(`proving the product build on the untouched tree: ${args.build}`);
    const t0 = Date.now();
    const b = await args.boundedExec(args.build, args.worktree);
    const last = tail(b.output, 300).split("\n").filter((l) => l.trim()).pop() ?? "";
    args.log(`  ${b.code === 0 ? "held" : "did not hold"} in ${since(t0)}${b.code === 0 || !last ? "" : ` — ${last}`}`);
    if (b.code === 0)
      for (const e of await ignoredEntries(args.worktree, args.exec))
        if (!before.has(e) && !provisioned.includes(e) && !built.includes(e)) built.push(e);
    if (b.code !== 0)
      return {
        provisioned,
        built,
        refusal: `the repository's own product build (${args.build}) fails on the untouched tree — nothing this run delivers could ship:\n${tail(b.output)}`,
      };
  }
  // Each command that RAN here is minted; one that did not is absent, not
  // an empty string. An empty string was accepted by every consumer and
  // executed by one of them.
  const one = await proveRunOne(args);
  // Tried on a real test and failed is not "nothing to prove it on": a run
  // that starts here has no way to judge a single check, and every unit
  // would end "not judged". Refused at the door, naming what failed.
  if (one.tried && !one.held)
    return {
      provisioned,
      built,
      refusal:
        `the single-test command did not hold on ${one.sample}: ${one.why ?? "it did not run the test"} — ` +
        `nothing could judge a check here. Fix the command or the tree it runs in, and run again.`,
    };
  const ranOne = one.held;
  // Each part's own command, proved in its own tree on one of its own
  // tests. A part with nothing to prove it on yet keeps what it was told —
  // the first check written there proves it in use.
  const parts: Record<string, { provision?: string; prepare?: string; runOne?: string }> = {};
  for (const [root, told] of Object.entries(args.partCommands ?? {})) {
    if (root === "." || !told.runOne) continue;
    const proved = await proveRunOne({ ...args, runOne: told.runOne }, root);
    if (proved.tried && !proved.held)
      return {
        provisioned,
        built,
        refusal:
          `${root}'s single-test command did not hold on ${proved.sample}: ${proved.why ?? "it did not run the test"} — ` +
          `nothing could judge a check in ${root}. Fix the command or the tree it runs in, and run again.`,
      };
    parts[root] = { ...told, ...(proved.held ? { runOne: proved.held } : {}) };
  }
  const ranSuite = args.suite
    ? args.suiteProvenBefore
      ? args.suite
      : await proveSuite(args, args.suite)
    : "";
  return {
    provisioned,
    built,
    ...(ranOne ? { runOne: proved(ranOne, true) } : {}),
    ...(Object.keys(parts).length ? { parts } : {}),
    ...(ranSuite ? { suite: proved(ranSuite, true) } : {}),
    // Provision, prepare and build reached here only by exiting zero above.
    ...(args.provision ? { provision: proved(args.provision, true) } : {}),
    ...(args.prepare ? { prepare: proved(args.prepare, true) } : {}),
    ...(args.build ? { build: proved(args.build, true) } : {}),
  };
}

/**
 * The test runners a tree may need that its runtime dependencies do not
 * install, with how to install each. A part's tests run in CI inside an
 * image that carries the runner; the worktree carries only what the
 * repository's own provisioning installs, which is the product's needs.
 */
const TEST_RUNNERS: { tool: string; install: string; when: RegExp }[] = [
  { tool: "pytest", install: "python3 -m pip install --break-system-packages pytest", when: /\.py$/ },
];

/**
 * The single-test command, tried on one of the repository's own tests.
 * `tried` says a test was there to try it on; `held` is the command when
 * it ran that test, or "" with `why` when it did not. The gate's whole
 * suite still stands behind every slice either way.
 */
async function proveRunOne(
  args: SetupArgs,
  part = ".",
): Promise<{ held: string; tried: boolean; sample?: string; why?: string }> {
  if (!args.runOne) return { held: "", tried: false };
  const listed = (await args.exec("git", ["-C", args.worktree, "ls-files"], args.worktree)).out.split("\n").map((l) => l.trim());
  // A part's command is proved on a test OF THAT PART, in that part's own
  // directory. Proving the frontend's runner against a backend test says
  // nothing about either, and the wrong runner's "no such file" would be
  // read as the command not holding at all. The repository-wide command,
  // in turn, is never proved on a file a declared part owns: that file has
  // its own command, and the wide one failing on it says nothing either.
  const parts = Object.keys(args.partCommands ?? {}).filter((r) => r !== ".");
  const owns = (r: string, f: string): boolean => f === r || f.startsWith(`${r}/`);
  const under = (f: string): boolean =>
    part === "." ? !parts.some((r) => owns(r, f)) : owns(part, f);
  // A test, not a fixture beside one: nothing is proved on an `__init__.py`,
  // a `conftest.py` or a `setup.js`, which are not tests and fail as if
  // the command had. A test wears a test's name — `.test.js`, `.spec.ts`,
  // `test_x.py`, `x_test.go` — and only such a file is tried.
  const aTest = (f: string): boolean => {
    const base = f.split("/").pop() ?? f;
    if (/^(__init__|conftest|setup|vitest\.setup|jest\.setup|testSetup|setupTests)\.[a-z]+$/.test(base)) return false;
    if (/(^|\/)__pycache__\//.test(f)) return false;
    return /\.(test|spec)\.[a-z]+$|_(test|spec)\.[a-z]+$|^test_.*\.[a-z]+$/.test(base);
  };
  const sample = listed
    .filter((f) => f && isTestPath(f) && !isProbePath(f) && aTest(f) && under(f))
    .sort((a, b) => a.length - b.length)[0];
  if (!sample) {
    args.log(
      part === "."
        ? "  no test of the repository's own to prove the single-test command on — slices run without it"
        : `  ${part} has no test of its own yet — its command proves itself on the first check written there`,
    );
    return { held: "", tried: false };
  }
  const where = part === "." ? args.worktree : `${args.worktree}/${part}`;
  // The runner the tests need, when the tree's own provisioning did not
  // bring it: installed here, once, and said so.
  for (const runner of TEST_RUNNERS) {
    if (!runner.when.test(sample) || !new RegExp(`\\b${runner.tool}\\b`).test(args.runOne)) continue;
    const there = await args.boundedExec(`command -v ${runner.tool}`, where);
    if (there.code === 0) continue;
    args.log(`installing ${part === "." ? "the" : `${part}'s`} test runner, ${runner.tool}: ${runner.install}`);
    const got = await args.boundedExec(runner.install, where);
    args.log(`  ${got.code === 0 ? "installed" : `did not install — ${tail(got.output, 200).split("\n").pop() ?? ""}`}`);
  }
  // The command is written for the part's own tree: `<file>` is the path as
  // that part's runner takes it, and the command runs where that part is.
  const inPart = part === "." ? sample : sample.slice(part.length + 1);
  const cmd = args.runOne.replace(/<file>/g, inPart);
  args.log(`proving ${part === "." ? "the" : `${part}'s`} single-test command on ${sample}: ${cmd}`);
  const t0 = Date.now();
  const r = await args.boundedExec(cmd, where);
  // Held means the runner RAN the test — green, or red in the runner's own
  // words. A red test on the base is the base's business; a command that
  // cannot run one file at all is not a way to run one.
  const ran = r.code === 0 || /^(not )?ok \d+|\b\d+ (passed|failed)\b|^(--- )?(PASS|FAIL)\b/m.test(r.output);
  const why = tail(r.output, 300).split("\n").filter((l) => l.trim()).pop() ?? "";
  args.log(`  ${ran ? "held" : "did not hold"} in ${since(t0)}${ran ? "" : ` — ${why}`}`);
  return ran ? { held: args.runOne, tried: true, sample } : { held: "", tried: true, sample, why };
}

/**
 * What the door lends or produces must never reach a commit.
 *
 * The repository's own ignore rules do not promise that: `node_modules/`
 * with a trailing slash matches a directory and NOT a symlink, so a lent
 * link is stageable — and the gate's `git add -A` once committed four of
 * them onto a run's branch, after which every fresh checkout of that
 * branch recreated links into the base checkout and the suite judged the
 * wrong tree forever after. The worktree's own exclude file closes it,
 * with bare names, which match files, directories and symlinks alike.
 */
async function excludeFromGit(worktree: string, entries: readonly string[], exec: Exec): Promise<void> {
  if (!entries.length) return;
  const rel = (await exec("git", ["-C", worktree, "rev-parse", "--git-path", "info/exclude"], worktree)).out.trim();
  if (!rel) return;
  const file = path.isAbsolute(rel) ? rel : path.join(worktree, rel);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const had = await fs.readFile(file, "utf8").catch(() => "");
    const lines = new Set(had.split("\n").filter(Boolean));
    for (const e of entries) lines.add(`/${e.replace(/\/$/, "")}`);
    await fs.writeFile(file, `${[...lines].join("\n")}\n`);
  } catch {
    /* an unwritable exclude falls back to the repository's own rules */
  }
}


/**
 * Build the delivered tree before the closing checks. A failure is spoken
 * and RETURNED: the checks still run, so the person sees every verdict —
 * but a tree that does not build is handed over to nobody. Three runs once
 * reported deliveries of a branch the product build rejected, because this
 * step only warned.
 */
/**
 * What a failed build actually said, in the words the compiler used.
 *
 * This reported the LAST line of the output. A compiler's output ends in a
 * blank line, so what it printed was the word "tree:" and nothing after
 * it — a build failure with no reason, at the one gate where the reason
 * decides whether ten promises are kept. The closer then spent rounds
 * guessing at a message it was never shown, and said so.
 *
 * The lines that name a file and a position are what a person and a
 * closer both need, so those come first; failing that, the last lines
 * that say anything at all.
 */
export function buildComplaint(output: string): string {
  const lines = output.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return "(the build failed and printed nothing)";
  const named = lines.filter((l) => /\.[cm]?[jt]sx?[(:]\d+|error [A-Z]+\d+|\berror\b/i.test(l));
  return (named.length ? named : lines).slice(0, 12).join("\n").slice(0, 2000);
}

export async function prepareAtGate(
  prepare: string | undefined,
  worktree: string,
  boundedExec: BoundedExec,
  log: (line: string) => void,
): Promise<{ ok: boolean; words: string }> {
  if (!prepare) return { ok: true, words: "" };
  const prep = await boundedExec(prepare, worktree);
  if (prep.code !== 0) log(`⚠ the build failed at the gate — checks run against an unbuilt tree:\n${buildComplaint(prep.output)}`);
  return { ok: prep.code === 0, words: prep.output.slice(-3000) };
}


function setupArgsFor(a: {
  worktree: string;
  repoRoot: string;
  partCommands?: Record<string, { provision?: string; prepare?: string; runOne?: string }>;
  known?: {
    suite?: string;
    builds?: string[];
    dependencies?: string[];
    parts?: Record<string, { provision?: string; prepare?: string; runOne?: string }>;
  };
  told: { provision?: string; prepare?: string; build?: string; runOne?: string; suite?: string };
  exec: Exec;
  boundedExec: BoundedExec;
  log: (line: string) => void;
  resetup?: SetupArgs["resetup"];
  proven?: SetupArgs["proven"];
}): SetupArgs {
  const suite = a.known?.suite ?? a.told.suite ?? "";
  return {
    worktree: a.worktree,
    repoRoot: a.repoRoot,
    exec: a.exec,
    boundedExec: a.boundedExec,
    log: a.log,
    ...(suite ? { suite } : {}),
    ...(a.known?.suite === suite ? { suiteProvenBefore: true } : {}),
    ...(a.known?.dependencies?.length ? { dependencies: a.known.dependencies } : {}),
    ...(a.partCommands ? { partCommands: a.partCommands } : {}),
    ...(a.known?.builds?.length ? { builds: a.known.builds } : {}),
    ...(a.told.provision ? { provision: a.told.provision } : {}),
    ...(a.told.prepare ? { prepare: a.told.prepare } : {}),
    ...(a.told.build ? { build: a.told.build } : {}),
    ...(a.told.runOne ? { runOne: a.told.runOne } : {}),
    ...(a.resetup ? { resetup: a.resetup } : {}),
    ...(a.proven ? { proven: a.proven } : {}),
  };
}

/**
 * Open the door: prove the tree, and mend a resumed branch once before
 * refusing.
 *
 * A run that resumes a branch an earlier run left half-committed fails its
 * own setup for damage nobody in this run caused. The mend is bounded and
 * happens once; if it changes anything, the door is asked again, and only
 * then does a refusal stand.
 */
export async function openTheDoor(a: {
  worktree: string;
  repoRoot: string;
  tep: string;
  known?: {
    suite?: string;
    builds?: string[];
    dependencies?: string[];
    parts?: Record<string, { provision?: string; prepare?: string; runOne?: string }>;
  };
  told: {
    provision?: string;
    prepare?: string;
    build?: string;
    runOne?: string;
    suite?: string;
    /** Each part's own commands, as the repository declares them. */
    parts?: Record<string, { provision?: string; prepare?: string; runOne?: string }>;
    resetup?: SetupArgs["resetup"];
    proveSetup?: SetupArgs["proven"];
  };
  exec: Exec;
  boundedExec: BoundedExec;
  log: (line: string) => void;
  defect: Parameters<typeof repairStandingTree>[0]["defect"];
  resumed: boolean;
  halted: () => boolean;
}): Promise<TreeSetup> {
  // Asked BEFORE the tree is proved, so a repository that cannot say how it
  // runs its suite costs a minute rather than a whole run.
  const suite =
    a.known?.suite ||
    a.told.suite ||
    (await askForTheSuite({ ...(a.told.resetup ? { resetup: a.told.resetup } : {}), log: a.log }));
  const open = (): Promise<TreeSetup> =>
    setupRunTree(
      setupArgsFor({
        worktree: a.worktree,
        repoRoot: a.repoRoot,
        // What the repository declares for a part wins over what an earlier
        // run proved: the declaration is the newer word, and the door proves
        // it again here.
        ...(a.known?.parts || a.told.parts ? { partCommands: { ...(a.known?.parts ?? {}), ...(a.told.parts ?? {}) } } : {}),
        ...(a.known ? { known: a.known } : {}),
        told: { ...a.told, ...(suite ? { suite } : {}) },
        exec: a.exec,
        boundedExec: a.boundedExec,
        log: a.log,
        ...(a.told.resetup ? { resetup: a.told.resetup } : {}),
        ...(a.told.proveSetup ? { proven: a.told.proveSetup } : {}),
      }),
    );
  const ready = await open();
  // ABSENT IS A FACT. A repository with no whole-suite command has no
  // standing suite to hold a delivery to — the veto does not exist for it,
  // the same way no product build removes that veto. This used to be a
  // refusal, which locked out every repository nobody has tested yet: the
  // platform's normal case, and the ones Tandem exists to give their first
  // check. What absence must never become is an empty string reaching a
  // shell — the gate now takes no command at all instead.
  // The product build is the run's second veto. A repository that ships
  // nothing built has no such veto, which is legitimate — and silent
  // until it is said.
  if (!ready.refusal && !a.told.build)
    a.log("this repository ships nothing built — the product-build veto does not apply to this run");
  if (!ready.refusal || !a.resumed) return ready;
  const rebuild = async (): Promise<{ ok: boolean; words: string }> =>
    a.told.prepare
      ? a.boundedExec(a.told.prepare, a.worktree).then((r) => ({ ok: r.code === 0, words: r.output }))
      : { ok: true, words: "" };
  const mended = await repairStandingTree({
    worktree: a.worktree,
    tep: a.tep,
    refusal: ready.refusal,
    deps: a.told as never,
    exec: a.exec,
    log: a.log,
    defect: a.defect,
    halted: a.halted,
    rebuild,
  });
  return mended ? open() : ready;
}
