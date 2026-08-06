/**
 * The session's disk seams, factored out: the per-ask digest store and the
 * append-only space persistence (secret-scanned records; state as the fold).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Space } from "../core/schema";
import { appendRecord, loadFolded } from "../core/records";
import { scanForSecrets } from "../engine/store/frontmatter";
import { DigestStore } from "../derive/pipeline";

export function makeDigestStore(storeDir: string): DigestStore {
  const dir = path.join(storeDir, "digests");
  return {
    load: (askId) => {
      try {
        return fs.readFileSync(path.join(dir, `${askId}.md`), "utf8");
      } catch {
        return undefined;
      }
    },
    save: (askId, text) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${askId}.md`), text);
    },
  };
}

/** Append one snapshot record — refused (with the leak named) on a secret. */
export function persistSpace(args: {
  storeDir: string;
  author: string;
  now: () => string;
  space: Space;
  cut: string[];
  lastWritten: string;
  onRefused: (message: string) => void;
}): string {
  const body = JSON.stringify({ space: args.space, cut: args.cut });
  if (body === args.lastWritten) return args.lastWritten;
  const secrets = scanForSecrets(body);
  if (secrets.length) {
    args.onRefused(
      `REFUSED to write the store: secret-shaped content detected (${secrets
        .map((m) => m.pattern)
        .join(", ")}) — remove it from the ask/changes first.`,
    );
    return args.lastWritten;
  }
  appendRecord(args.storeDir, {
    at: args.now(),
    author: args.author,
    kind: "snapshot",
    space: args.space,
    cut: args.cut,
  });
  return body;
}

export function loadSpace(args: {
  projectDir?: string;
  storeDir: string;
  author: string;
  now: () => string;
}): { space: Space; cut: string[] } {
  return loadFolded(
    args.projectDir ?? args.storeDir,
    args.storeDir,
    args.author,
    args.now,
  );
}
