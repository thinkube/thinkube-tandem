/**
 * How many processors this machine will actually give the run.
 *
 * `nproc` and `os.cpus()` report the HOST's processors. In a container the
 * kernel grants a quota instead, and nothing in the process is told: node
 * sizes its thread pool, Go sizes its scheduler and every build tool sizes
 * its worker count for processors the cgroup will never hand over. Each
 * child then asks for four times what exists, the kernel throttles all of
 * them, and everything — the editor included — runs at a fraction of
 * speed while looking, from inside, like a hang.
 *
 * That is not a theory: a run in a four-processor container reported a
 * load of twenty-one against sixteen advertised processors, one grading
 * round took thirty minutes, the editor stopped answering, and the watchdog
 * called it a stall because nothing had moved for nine minutes. Nothing was
 * broken and nothing was killed — no process ran out of memory — the work
 * was simply starved.
 *
 * So the quota is read where the kernel writes it, and the children are
 * told the truth.
 */
import * as fs from "node:fs";
import * as os from "node:os";

/** Where cgroup v2 and v1 each write the CPU quota. */
const V2 = "/sys/fs/cgroup/cpu.max";
const V1_QUOTA = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const V1_PERIOD = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

/**
 * The processors this process may actually use, rounded down, never below
 * one. The host's count when there is no quota — a plain machine, a
 * container with no limit ("max"), or a kernel that writes neither file.
 */
export function cpuAllowance(read: (p: string) => string = (p) => fs.readFileSync(p, "utf8")): number {
  const host = Math.max(1, os.cpus().length);
  const fromQuota = (quota: number, period: number): number | undefined =>
    quota > 0 && period > 0 ? Math.max(1, Math.floor(quota / period)) : undefined;
  try {
    const [quota, period] = read(V2).trim().split(/\s+/);
    if (quota !== "max") {
      const n = fromQuota(Number(quota), Number(period));
      if (n) return Math.min(n, host);
    } else return host;
  } catch {
    /* not cgroup v2 — try v1 below */
  }
  try {
    const n = fromQuota(Number(read(V1_QUOTA).trim()), Number(read(V1_PERIOD).trim()));
    if (n) return Math.min(n, host);
  } catch {
    /* no quota anywhere: the host's processors are the answer */
  }
  return host;
}

/**
 * Tell a child process what it really has.
 *
 * Only the knobs the tools this run spawns actually read: Go's scheduler
 * (esbuild, and anything else built in Go), and libuv's thread pool (node's
 * file and compression work). Neither is set by anything else here, so a
 * value a caller chose deliberately is left alone.
 */
export function withCpuTruth(env: NodeJS.ProcessEnv, cpus = cpuAllowance()): NodeJS.ProcessEnv {
  return {
    ...env,
    GOMAXPROCS: env.GOMAXPROCS ?? String(cpus),
    UV_THREADPOOL_SIZE: env.UV_THREADPOOL_SIZE ?? String(cpus),
  };
}

/**
 * How many units may run at once.
 *
 * A unit is never one processor's worth of work: it is a worker, and the
 * builds and checks it starts. It also never has the container to itself —
 * the editor, the run's own driver and whatever else shares this pod must
 * keep answering while the run works, and starving them is exactly what
 * makes a working run look like a dead one.
 *
 * So the run takes half of what it is granted and leaves the other half.
 * On four processors that is two, which is what it already did; the point
 * is that it is now READ rather than assumed, so a smaller container gets
 * one instead of two, and a larger one is not held to a number chosen for
 * somebody else's machine.
 */
export function unitsAtOnce(cpus = cpuAllowance()): number {
  return Math.max(1, Math.min(4, Math.floor(cpus / 2)));
}
