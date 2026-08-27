/**
 * Which files changed in a repository since a recorded commit — committed
 * moves plus uncommitted edits. Undefined when the recorded commit is
 * unknown to the repository (rewritten history): the caller must treat
 * that as "everything may have moved".
 */
import { GitRunner } from "./stamp";
import { execFile } from "node:child_process";

const defaultRunner: GitRunner = (root, args) =>
  new Promise((resolve, reject) =>
    execFile("git", ["-C", root, ...args], { encoding: "utf8" }, (err, out) =>
      err ? reject(err) : resolve(out.trim()),
    ),
  );

export async function filesChangedSince(
  root: string,
  head: string,
  run: GitRunner = defaultRunner,
): Promise<Set<string> | undefined> {
  try {
    const committed = await run(root, ["diff", "--name-only", `${head}..HEAD`]);
    const dirty = await run(root, ["status", "--porcelain"]);
    const out = new Set<string>();
    for (const l of committed.split("\n")) if (l.trim()) out.add(l.trim());
    for (const l of dirty.split("\n")) if (l.trim()) out.add(l.trim().slice(3));
    return out;
  } catch {
    return undefined;
  }
}
