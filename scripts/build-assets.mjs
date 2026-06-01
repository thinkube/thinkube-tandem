// Copies non-TypeScript assets that need to ship inside the extension bundle.
// Run after `tsc` as part of `npm run compile`.
//
// Today: wrapper/* → dist/wrapper/*  (POSIX scripts get chmod +x).
// Add new asset copies here as the bundle grows; keep this script dependency-free.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const wrapperSrc = path.join(repoRoot, "wrapper");
const wrapperDest = path.join(repoRoot, "dist", "wrapper");

await fs.mkdir(wrapperDest, { recursive: true });

const entries = await fs.readdir(wrapperSrc);
for (const name of entries) {
  const from = path.join(wrapperSrc, name);
  const to = path.join(wrapperDest, name);
  await fs.copyFile(from, to);
  if (
    process.platform !== "win32" &&
    (name.endsWith(".sh") || name.endsWith(".cmd"))
  ) {
    await fs.chmod(to, 0o755);
  }
  console.log(
    `copied ${path.relative(repoRoot, from)} → ${path.relative(repoRoot, to)}`,
  );
}
