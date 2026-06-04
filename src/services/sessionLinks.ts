/**
 * Session-link core — pure fs logic, no vscode dependency (so it can be
 * smoke-tested with plain node against a temp dir).
 *
 * Why this exists: the claude-code extension scopes its Session History
 * picker — and resume-by-id opens — to ONE directory,
 * `~/.claude/projects/<encoded cwd>/`, where cwd is workspaceFolders[0].
 * Sessions our launcher creates are deliberately rooted in the *clicked*
 * folder, so their transcripts land in a different encoded dir and are
 * invisible to the picker. Worse, a window reload respawns every Claude
 * panel without its session id (claude-code's webview serializer drops
 * it), so those sessions become unreachable from the UI entirely.
 *
 * The bridge is deliberately dumb: symlink each launcher-created session
 * transcript into the picker's project dir. The picker then lists it,
 * renders its history, and resumes it natively — and the cwd-patching
 * wrapper's RESUME branch already routes the spawn back to the session's
 * original folder (it reads `cwd` from inside the JSONL).
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * claude-code's project-dir encoding (verified against the bundle):
 * NFC-normalised absolute path, every non-alphanumeric char to "-".
 */
export function encodeProjectDir(absPath: string): string {
  return absPath.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");
}

/** `~/.claude/projects`, honouring CLAUDE_CONFIG_DIR like the CLI does. */
export function claudeProjectsRoot(): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return path.join(configDir, "projects");
}

/**
 * realpath with the same fallback claude-code uses: if the path can't be
 * resolved (deleted, no permission), encode the raw path instead.
 */
async function canonical(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

/**
 * symlink src → dst; EEXIST means already mirrored. Windows without symlink
 * privilege gets EPERM — hardlinks work unprivileged and both paths sit
 * under projectsRoot, i.e. the same volume.
 */
async function linkInto(src: string, dst: string): Promise<boolean> {
  try {
    await fs.symlink(src, dst);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (code === "EPERM" || code === "UNKNOWN") {
      return fs.link(src, dst).then(
        () => true,
        () => false,
      );
    }
    throw err;
  }
}

export interface SweepResult {
  linked: number;
  pruned: number;
}

/**
 * Mirror every `<uuid>.jsonl` from the targets' project dirs into the
 * picker's project dir via symlinks, and drop symlinks whose target is
 * gone. Real files in the picker dir are never touched.
 *
 * Known trade-off: "Remove" in the picker UI only deletes the symlink, so
 * the next sweep resurrects the session. Deliberate for v1 — the original
 * transcript is the source of truth and we never destroy it.
 */
export async function sweepSessionLinks(
  pickerCwd: string,
  targetCwds: readonly string[],
  projectsRoot: string = claudeProjectsRoot(),
): Promise<SweepResult> {
  const pickerDir = path.join(
    projectsRoot,
    encodeProjectDir(await canonical(pickerCwd)),
  );
  await fs.mkdir(pickerDir, { recursive: true });

  let linked = 0;
  for (const target of targetCwds) {
    const targetDir = path.join(
      projectsRoot,
      encodeProjectDir(await canonical(target)),
    );
    if (targetDir === pickerDir) continue;

    let entries;
    try {
      entries = await fs.readdir(targetDir, { withFileTypes: true });
    } catch {
      continue; // no sessions recorded for this target yet
    }
    for (const entry of entries) {
      // Plain transcript files only: skips per-session subdirs
      // (subagents/, tool-results/) and any symlinks, so links never chain.
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const src = path.join(targetDir, entry.name);
      const dst = path.join(pickerDir, entry.name);
      if (await linkInto(src, dst)) linked++;
    }
  }

  // Prune dangling symlinks (session deleted at the source).
  let pruned = 0;
  for (const entry of await fs.readdir(pickerDir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const p = path.join(pickerDir, entry.name);
    try {
      await fs.stat(p); // follows the link
    } catch {
      await fs.unlink(p).catch(() => {});
      pruned++;
    }
  }
  return { linked, pruned };
}

/**
 * Make one transcript visible to claude-code's picker / resume-by-id
 * validation (docs/claude-code-internals.md, F6) without a full sweep.
 */
export async function ensureSessionLinked(
  sessionFile: string,
  pickerCwd: string,
  projectsRoot: string = claudeProjectsRoot(),
): Promise<void> {
  const pickerDir = path.join(
    projectsRoot,
    encodeProjectDir(await canonical(pickerCwd)),
  );
  if (path.dirname(sessionFile) === pickerDir) return; // already native there
  await fs.mkdir(pickerDir, { recursive: true });
  await linkInto(sessionFile, path.join(pickerDir, path.basename(sessionFile)));
}

export interface SessionInfo {
  uuid: string;
  /** Absolute path to the real transcript (never a symlink). */
  file: string;
  /** The cwd recorded inside the transcript — where the session "lives". */
  cwd: string;
  /** Last ai-title sidecar record, if any (what the picker displays). */
  title?: string;
  mtimeMs: number;
}

/**
 * Find every session whose recorded cwd is `folder` or a subfolder of it,
 * across ALL project dirs. The encoded dir name is lossy (any non-alnum
 * char becomes "-"), so membership is decided by the `"cwd"` field inside
 * each transcript — the same field the wrapper's RESUME branch trusts.
 * Newest first.
 */
export async function listSessionsForFolder(
  folder: string,
  projectsRoot: string = claudeProjectsRoot(),
): Promise<SessionInfo[]> {
  // The CLI records its post-cd process cwd, which may or may not be fully
  // resolved — accept a match against either spelling of the folder.
  const bases = new Set([
    folder.normalize("NFC"),
    (await canonical(folder)).normalize("NFC"),
  ]);
  const belongs = (cwd: string) => {
    for (const b of bases) {
      if (cwd === b || cwd.startsWith(b + path.sep)) return true;
    }
    return false;
  };

  const out: SessionInfo[] = [];
  let dirs;
  try {
    dirs = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(projectsRoot, d.name);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Real files only — symlinks are our own mirrors of other dirs'
      // transcripts and would produce duplicates.
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(dir, entry.name);
      const cwd = await readFirstJsonString(file, "cwd");
      if (!cwd || !belongs(cwd.normalize("NFC"))) continue;
      const st = await fs.stat(file).catch(() => undefined);
      if (!st) continue;
      out.push({
        uuid: entry.name.slice(0, -".jsonl".length),
        file,
        cwd,
        title: await readLastJsonString(file, "aiTitle"),
        mtimeMs: st.mtimeMs,
      });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Scan a transcript from the start for the first `"key":"value"` and return
 * the (unescaped) value. Chunked with overlap so we never load a multi-MB
 * transcript just to read its first cwd; capped — if the key hasn't shown
 * up in the first MB it isn't the record we're after.
 */
async function readFirstJsonString(
  file: string,
  key: string,
  maxBytes = 1 << 20,
): Promise<string | undefined> {
  const re = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`);
  const fh = await fs.open(file, "r");
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let carry = "";
    let pos = 0;
    while (pos < maxBytes) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
      if (bytesRead === 0) break;
      const text = carry + chunk.toString("utf8", 0, bytesRead);
      const m = re.exec(text);
      if (m) return unescapeJson(m[1]);
      carry = text.slice(-512); // overlap: a match can't straddle a boundary
      pos += bytesRead;
    }
    return undefined;
  } finally {
    await fh.close();
  }
}

/**
 * Find the LAST `"key":"value"` in a transcript, reading only the tail —
 * sidecar records like ai-title are appended, and last-one-wins is exactly
 * the picker's behaviour.
 */
async function readLastJsonString(
  file: string,
  key: string,
  tailBytes = 64 * 1024,
): Promise<string | undefined> {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const text = buf.toString("utf8");
    const re = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`, "g");
    let m;
    let last: string | undefined;
    while ((m = re.exec(text))) last = m[1];
    return last === undefined ? undefined : unescapeJson(last);
  } finally {
    await fh.close();
  }
}

function unescapeJson(escaped: string): string | undefined {
  try {
    return JSON.parse(`"${escaped}"`) as string;
  } catch {
    return undefined; // truncated escape at a chunk boundary — skip
  }
}
