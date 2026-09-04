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

/**
 * The parts of this repository that answer at the address a person opens.
 *
 * The repository says it: a route with the shortest path is the one a
 * person lands on, and the container it names is built from a directory.
 * Promises that land in that directory are promises about the page, and a
 * page is judged in a browser.
 *
 * Nothing here knows what a frontend is made of. A repository that
 * declares no routes has no page, and nothing is driven.
 */
export function pageRoots(repoRoot: string): string[] {
  const read = thinkubeDeclaration(repoRoot);
  if (!read || !("declared" in read)) return [];
  const { routes, containers } = read.declared;
  if (!routes.length) return [];
  const shortest = routes.reduce((a, b) => (b.path.length < a.path.length ? b : a));
  return containers
    .filter((c) => c.name === shortest.to)
    .map((c) => c.build.replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((r) => r && r !== ".");
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

/**
 * Why the platform refused the pushed commit, in its own words.
 *
 * The failing step's name, and its log where the platform will give it —
 * which is what names the files to repair. Nothing is inferred: a step
 * that says nothing leaves the evidence thin, and the loop says so.
 */
export async function whyItFailed(repoRoot: string, app: string, since: string): Promise<{ evidence: string; files: string[] }> {
  const controlUrl = controlUrlOf(await remoteOf(repoRoot));
  const token = apiToken();
  const reading = await readLive(repoRoot, app, since);
  const broke = (reading.stages ?? []).filter((s) => /fail|error/i.test(s.status));
  const parts: string[] = [];
  for (const st of broke) {
    parts.push(`── ${st.name} ── ${st.said ?? ""}`);
    if (st.pod && reading.id && controlUrl && token) {
      const log = await stepLog(controlUrl, reading.id, st.pod, token);
      if (log) parts.push(log.split("\n").slice(-120).join("\n"));
    }
  }
  const evidence = parts.join("\n").slice(-8000) || `the platform's build ended ${reading.phase ?? "without succeeding"}`;
  return { evidence, files: namedFiles(evidence, repoRoot) };
}

/**
 * The files a tool's words name, as paths in THIS repository.
 *
 * A compiler runs inside the part it builds, so it says
 * "src/lib/taskView.test.tsx" for a file the repository keeps at
 * "frontend/src/lib/taskView.test.tsx". Each part the repository declares
 * is tried as a prefix, and only a path that exists is kept — a guess that
 * does not exist is not a file, and sending a repair after one is worse
 * than sending it after none.
 */
export function namedFiles(words: string, repoRoot: string): string[] {
  const read = thinkubeDeclaration(repoRoot);
  const prefixes = read && "declared" in read
    ? [
        "",
        ...read.declared.containers.map((c) => c.build.replace(/^\.\//, "").replace(/\/$/, "")),
        ...read.declared.parts.map((p) => p.root),
      ].filter((p) => p !== ".")
    : [""];
  const out = new Set<string>();
  for (const m of words.matchAll(/(?:[\w.@-]+\/)+[\w.@-]+\.[a-zA-Z]{1,5}/g)) {
    const said = m[0].replace(/^\.\//, "");
    for (const p of prefixes) {
      const rel = p ? `${p}/${said}` : said;
      if (fs.existsSync(path.join(repoRoot, rel))) {
        out.add(rel);
        break;
      }
    }
  }
  return [...out];
}

async function stepLog(controlUrl: string, id: string, pod: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${controlUrl}/api/v1/cicd/pipelines/${id}/logs/${pod}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return "";
    const body: unknown = await res.json().catch(() => "");
    return typeof body === "string" ? body : ((body as { logs?: string; content?: string })?.logs ?? (body as { content?: string })?.content ?? "");
  } catch {
    return "";
  }
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
