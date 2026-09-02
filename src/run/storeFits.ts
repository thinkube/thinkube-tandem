/**
 * Whether a dependency store was installed for this machine's C library.
 *
 * npm records, in the store's own lock file, the native packages it chose
 * for the platform it installed on — `libc: ["musl"]` for an Alpine image.
 * A store made there carries no glibc build of the same modules, so a
 * build over it dies on a Debian host with "cannot find module". Read
 * before borrowing, so the door installs instead of failing.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** This process's C library, as Node reports it. */
function hostLibc(): "glibc" | "musl" {
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
  return header?.glibcVersionRuntime ? "glibc" : "musl";
}

/** Why the store at `dir` cannot be used here, or nothing when it can. */
export function storeIsForAnotherLibc(dir: string, host: "glibc" | "musl" = hostLibc()): string | undefined {
  let lock: { packages?: Record<string, { libc?: string[]; os?: string[] }> };
  try {
    lock = JSON.parse(fs.readFileSync(path.join(dir, ".package-lock.json"), "utf8")) as typeof lock;
  } catch {
    return undefined;
  }
  const libcs = new Set<string>();
  for (const p of Object.values(lock.packages ?? {})) for (const l of p.libc ?? []) libcs.add(l);
  if (!libcs.size || libcs.has(host)) return undefined;
  return `its native modules were installed for ${[...libcs].join("/")}, and this machine runs ${host}`;
}
