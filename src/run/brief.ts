/**
 * What the code author is told about its own feedback.
 *
 * Under tests-first the probes are written before the coder starts, and the
 * oracle's rule is "probe source never reaches the coder; results do". The
 * tool denials in `runWorker` enforce that; this is where it is SAID, so
 * the author knows why it has no shell rather than discovering it as a
 * failure. Both halves have to exist: a gate nobody explains reads as a
 * broken environment, and a sentence nothing enforces is a suggestion.
 */

/** The stanza appended to a worker's brief when the oracle can answer. */
export function coderStanza(oracleAvailable: boolean): string {
  if (!oracleAvailable) return "";
  return (
    "\n\nA `verify` tool is available (tandem MCP): it runs this slice's " +
    "acceptance checks against your CURRENT work in an isolated runner and " +
    "returns per-criterion PASS/FAIL with evidence. Use it before declaring " +
    "done — your completion is judged by its green, not by your claim." +
    "\n\nIt is your ONLY feedback channel. Never open, edit or create a test " +
    "or probe file, and never run a build, a test command or a package " +
    "manager — you have no shell. Work from the intent and the contract, and " +
    "ask `verify` how you are doing."
  );
}
