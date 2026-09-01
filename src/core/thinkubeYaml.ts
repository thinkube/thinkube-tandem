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
  /** The CI test hook: run `command` in `image`, before the build. */
  test?: { enabled: boolean; command?: string; image?: string };
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
  /** `app`, `knative`, or `component`. */
  deploymentType: string;
  containers: ThinkubeContainer[];
  deploy?: ThinkubeDeploy;
  verify?: ThinkubeVerify;
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
      spec?: {
        deployment?: { type?: string };
        deploy?: { run?: unknown; in?: unknown; at?: unknown };
        verify?: { still?: unknown; apply?: unknown; ask?: unknown; settled?: unknown };
        containers?: {
          name?: string;
          build?: string;
          test?: { enabled?: boolean; command?: string; image?: string };
        }[];
      };
    };
    const containers = (doc?.spec?.containers ?? [])
      .filter((c) => typeof c?.name === "string" && typeof c?.build === "string")
      .map((c) => ({
        name: c.name as string,
        build: c.build as string,
        ...(c.test
          ? {
              test: {
                enabled: c.test.enabled === true,
                ...(c.test.command ? { command: c.test.command } : {}),
                ...(c.test.image ? { image: c.test.image } : {}),
              },
            }
          : {}),
      }));
    const d = doc?.spec?.deploy;
    const run = lines(d?.run);
    const deploy: ThinkubeDeploy | undefined = d
      ? {
          run,
          ...(typeof d.in === "string" && d.in.trim() ? { in: d.in.trim() } : {}),
          ...(typeof d.at === "string" && d.at.trim() ? { at: d.at.trim() } : {}),
        }
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
        ...(deploy ? { deploy } : {}),
        ...(verify ? { verify } : {}),
      },
    };
  } catch (e) {
    return { unreadable: `thinkube.yaml exists but does not parse: ${(e as Error).message}` };
  }
}
