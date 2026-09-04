/**
 * Where a repository is seen, and how the platform's account of it is read.
 *
 * Both answers come from outside tandem: the address from the repository's
 * own file, the build from control. Nothing here knows what an app is made
 * of, and a repository the platform does not deploy simply has no address.
 */
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { controlUrlOf, readPipeline, type PipelineReading } from "./harvest";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** The address this repository says it is seen at, when it says one. */
export function deployedAddress(repoRoot: string): string | undefined {
  const read = thinkubeDeclaration(repoRoot);
  const at = read && "declared" in read ? read.declared.deploy?.at : undefined;
  return at && /^https?:\/\//.test(at) ? at : undefined;
}

function apiToken(home = process.env.HOME ?? "~"): string | undefined {
  try {
    const t = fs.readFileSync(path.join(home, ".thinkube", "api-token"), "utf8").trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

function remoteOf(repoRoot: string): Promise<string> {
  return new Promise((resolve) =>
    execFile("git", ["-C", repoRoot, "remote", "get-url", "origin"], (err, out) => resolve(err ? "" : out.trim())),
  );
}

/** The platform's own account of what it is doing with the pushed commit. */
export async function readLive(repoRoot: string, app: string, since: string): Promise<PipelineReading> {
  const controlUrl = controlUrlOf(await remoteOf(repoRoot));
  const token = apiToken();
  if (!controlUrl || !token)
    return { settled: false, stages: [], unreachable: "the platform cannot be asked from here" };
  return readPipeline({ controlUrl, app, since, token });
}

/** Does the address answer, and with what? Nothing when it does not. */
export async function knock(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    return res.status;
  } catch {
    return undefined;
  }
}
