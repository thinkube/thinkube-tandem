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

export interface ThinkubeDeclaration {
  /** `app`, `knative`, or `component`. */
  deploymentType: string;
  containers: ThinkubeContainer[];
  deploy?: ThinkubeDeploy;
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
    // One command or several, written either way — a repository with one
    // step should not have to write a list to say so.
    const run = (Array.isArray(d?.run) ? d.run : d?.run !== undefined ? [d.run] : [])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
    const deploy: ThinkubeDeploy | undefined = d
      ? {
          run,
          ...(typeof d.in === "string" && d.in.trim() ? { in: d.in.trim() } : {}),
          ...(typeof d.at === "string" && d.at.trim() ? { at: d.at.trim() } : {}),
        }
      : undefined;
    return {
      declared: {
        deploymentType: doc?.spec?.deployment?.type ?? "app",
        containers,
        ...(deploy ? { deploy } : {}),
      },
    };
  } catch (e) {
    return { unreadable: `thinkube.yaml exists but does not parse: ${(e as Error).message}` };
  }
}
