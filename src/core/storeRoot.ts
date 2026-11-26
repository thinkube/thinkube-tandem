/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the store is, for a process that is not the editor: the MCP server
 * and the record's command, which a hook starts at every prompt. It lives
 * in a file of its own so that such a process loads nothing else to learn
 * it.
 */
import * as path from "node:path";

/** The store, from the environment or the same default the editor uses. */
export function storeRootOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.TANDEM_STORE || path.join(env.HOME ?? "~", "thinkube-tandem-store");
}
