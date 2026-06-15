/**
 * The IPC framing between the on-PATH `tmux` shim CLI and the Extension Host
 * (SP-tgnb5o). Factored out of AgentTeamsShimServer so the wire protocol is
 * directly testable (SL-3's IPC-roundtrip test, SL-4's conformance harness)
 * without standing up VS Code.
 *
 * Protocol: the client (wrapper/tmux-shim.js) opens a connection, writes one
 * newline-terminated JSON line `{ "argv": [...] }`, and reads back one
 * newline-terminated JSON line `{ "stdout": string, "exitCode": number }`.
 * One request per connection (Claude spawns a fresh `tmux` per command).
 */
import * as net from "node:net";

/** The single method the server needs from the dispatcher. */
export interface Dispatcher {
  dispatch(argv: string[]): { stdout: string; exitCode: number };
}

/**
 * Create (but do not yet `listen`) a net.Server that answers the shim protocol
 * by routing each request line through `dispatcher`. A handler fault is
 * logged and degraded to `{stdout:"", exitCode:0}` so Claude's display never
 * crashes on our account (log-and-no-op, per the Spec).
 */
export function createTmuxShimServer(
  dispatcher: Dispatcher,
  log: (msg: string) => void = () => {},
): net.Server {
  return net.createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return; // wait for the full request line
      const line = buf.slice(0, nl);
      let argv: string[] = [];
      try {
        const req = JSON.parse(line) as { argv?: unknown };
        if (Array.isArray(req.argv)) argv = req.argv.map(String);
      } catch {
        log(`bad request: ${line}`);
      }
      let res: { stdout: string; exitCode: number };
      try {
        res = dispatcher.dispatch(argv);
      } catch (err) {
        log(`dispatch error for ${argv.join(" ")}: ${(err as Error).message}`);
        res = { stdout: "", exitCode: 0 };
      }
      conn.end(JSON.stringify(res) + "\n");
    });
    conn.on("error", () => {
      /* client went away mid-request; nothing to clean up */
    });
  });
}
