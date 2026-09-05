/**
 * The one door to the model, and the one place a test cannot walk through.
 *
 * A test that reaches the real model is not a test: it is slow, it is
 * paid for, and it answers differently every time. One did — a fake
 * worker passed in the wrong argument, so the finisher and the closer
 * called the model for real — and it turned a forty-five second suite
 * into ten minutes without failing anything.
 *
 * The suite sets `TANDEM_NO_MODEL`, and every door reads it here. A test
 * that reaches for the model now stops at once and says which door it
 * came through, instead of quietly spending minutes.
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
