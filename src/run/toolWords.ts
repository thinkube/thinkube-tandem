/**
 * The end of a tool's output, kept so a reader sees WHAT failed.
 *
 * A tail alone shows the summary and loses the lines that named the
 * failure; the named lines alone lose the context. Both, deduplicated,
 * bounded — because a person reading a refusal needs the tool's own words,
 * not a paraphrase of them.
 */
export function tail(output: string, n = 900): string {
  const lines = output.trim().split("\n");
  const named = lines.filter((l) => /^not ok|\b(FAIL|FAILED|Error|error:)\b/.test(l)).slice(-8);
  const last = lines.slice(-6);
  return [...new Set([...named, ...last])].join("\n").slice(-n);
}
