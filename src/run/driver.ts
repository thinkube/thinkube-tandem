/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The process that drives one run.
 *
 * Started detached by whoever pressed the button (see ./spawnDriver), it
 * attaches to the space exactly as the editor does, runs the signed work,
 * and exits. Everything it has to say goes to its record under the space's
 * runs directory, which every surface follows; this file's own output is a
 * log beside it, for the day the record says nothing.
 */
import { attach } from "../mcp/attach";

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function say(line: string): void {
  process.stderr.write(`${new Date().toISOString()} ${line}\n`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const repo = arg(argv, "repo");
  const space = arg(argv, "space");
  if (!repo || !space) {
    say("usage: driver --repo <dir> --space <slug> [--store <root>] [--storage <dir>] [--fresh]");
    return 2;
  }
  const storeRoot = arg(argv, "store");
  const storageDir = arg(argv, "storage");
  const fresh = argv.includes("--fresh");
  const r = await attach({
    repo,
    space,
    ...(storeRoot ? { storeRoot } : {}),
    ...(storageDir ? { storageDir } : {}),
    driveHere: true,
    onChanged: (m) => m && say(`· ${m}`),
  });
  if (!r.ok) {
    say(`not attached: ${r.reason}`);
    return 3;
  }
  say(`driving ${r.project.card.label} / ${space} as ${r.session.author} (pid ${process.pid})`);
  const out = await r.session.rerun(fresh);
  if (!out.ok) {
    say(`the run did not start: ${out.reason ?? "no reason given"}`);
    return 4;
  }
  say("the run ended");
  return 0;
}

if (require.main === module)
  void main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      say(`the driver crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      process.exit(1);
    },
  );
