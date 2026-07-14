/**
 * The module VS Code loads INSIDE the extension host (extensionTestsPath).
 * It requires the one host-probe named by TANDEM_HOST_PROBE and runs it —
 * the probe's thrown assertion is the failure, verbatim.
 */
export async function run(): Promise<void> {
  const probe = process.env.TANDEM_HOST_PROBE;
  if (!probe) throw new Error("TANDEM_HOST_PROBE not set — runner defect");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(probe) as { run?: (phase: number) => Promise<void> };
  if (typeof mod.run !== "function")
    throw new Error(`host probe ${probe} exports no run(phase): Promise<void>`);
  await mod.run(Number.parseInt(process.env.TANDEM_HOST_PHASE ?? "0", 10));
}
