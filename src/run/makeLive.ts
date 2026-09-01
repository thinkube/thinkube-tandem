/**
 * Making the work live, by whatever means the repository declares.
 *
 * Every target on this platform reaches production differently. An app is
 * deployed by being pushed — the pipeline does the rest. A component is
 * deployed by a playbook run from a different repository. A template is
 * deployed through a call into control. This extension is deployed by a
 * shell script sitting beside it, which for months nothing knew about, so
 * deploying was a thing a person remembered to do outside the loop.
 *
 * The mistake was treating those as four cases. They are one question —
 * *how is this made live?* — with four answers, and the answers belong to
 * the repositories rather than to this file. Nothing here knows what
 * ansible, gitea, copier or code-server are. It runs the strings it is
 * given, in order, in the directory it is told.
 *
 * That is what makes it an abstraction rather than a fifth branch: the tool
 * nobody has chosen yet — terraform, helm, a REST call to something that
 * does not exist — is a line of configuration, not a change here.
 *
 * The stakes are a re-run. This is a development platform: nothing served
 * from it has customers, so a deploy is not a thing to be approved, guarded
 * or staged. It is a command that either worked or did not.
 */
import { execFile } from "node:child_process";
import type { ThinkubeDeploy } from "../core/thinkubeYaml";

/** How a command is run. Injectable so a drive never spawns a shell. */
export type Invoke = (
  command: string,
  cwd: string,
) => Promise<{ code: number | null; out: string }>;

const spawn: Invoke = (command, cwd) =>
  new Promise((resolve) =>
    execFile("bash", ["-lc", command], { cwd, timeout: 900_000, maxBuffer: 8 << 20 }, (err, out, errOut) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${out}${errOut}` }),
    ),
  );

export interface WentLive {
  /** Whether every declared step succeeded. A repository declaring no
   *  steps is live already — the merge did it — which is success. */
  live: boolean;
  /** Where it can be seen, when the repository says. */
  at?: string;
  /** What a person reads: the step that failed, in the tool's own words. */
  detail?: string;
}

/**
 * Run what the repository declared, in order, stopping at the first failure.
 *
 * Stopping matters: these are steps of one deployment, so a second step run
 * after the first failed is acting on a state nobody intended. The tool's
 * own output is carried out unedited — a deploy that failed is read by a
 * person, and a paraphrase of an error is worth less than the error.
 */
export async function makeLive(a: {
  /** The repository being delivered — the default place to run. */
  repoRoot: string;
  deploy: ThinkubeDeploy;
  invoke?: Invoke;
  log?: (line: string) => void;
}): Promise<WentLive> {
  const at = a.deploy.at ? { at: a.deploy.at } : {};
  if (!a.deploy.run.length) return { live: true, ...at };

  const where = a.deploy.in ?? a.repoRoot;
  const run = a.invoke ?? spawn;
  for (const command of a.deploy.run) {
    a.log?.(`making it live: ${command}`);
    const r = await run(command, where);
    if (r.code !== 0)
      return {
        live: false,
        ...at,
        detail: `\`${command}\` exited ${r.code}\n${r.out.slice(-2000)}`,
      };
  }
  a.log?.(a.deploy.at ? `it is live at ${a.deploy.at}` : "it is live");
  return { live: true, ...at };
}
