/**
 * The one door to the model.
 *
 * Every place that reaches the SDK comes through here, so a single switch
 * closes them all: with `TANDEM_NO_MODEL` set — the suite sets it — this
 * throws, naming the door, rather than opening a paid, slow, and
 * differently-answering call from inside a test.
 */
export async function theModel(door: string): Promise<{
  query: (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown>;
}> {
  if (process.env.TANDEM_NO_MODEL === "1")
    throw new Error(
      `a test reached the real model through ${door} — pass a fake worker or round instead ` +
        `(this is what turns a fast suite into a slow one, and it never fails anything on its own)`,
    );
  return (await import("@anthropic-ai/claude-agent-sdk")) as {
    query: (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown>;
  };
}
