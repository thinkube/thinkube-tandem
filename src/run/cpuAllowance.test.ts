/**
 * The run is sized to the processors it is granted, not the ones it sees.
 *
 * `nproc` and `os.cpus()` report the HOST's processors; in a container the
 * kernel grants a quota and tells no one. A run in a four-processor
 * container, on a sixteen-processor host, drove the load to twenty-one:
 * every build tool sized its workers for sixteen, the kernel throttled all
 * of them, one grading round took thirty minutes, the editor stopped
 * answering, and the watchdog reported a stall because nothing had moved
 * for nine minutes. Nothing was broken and nothing ran out of memory —
 * `oom_kill 0` — the work was simply starved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { cpuAllowance, unitsAtOnce, withCpuTruth } from "./cpuAllowance";

/** A kernel that answers for exactly the files it has. */
const kernel = (files: Record<string, string>) => (p: string) => {
  if (!(p in files)) throw new Error(`ENOENT ${p}`);
  return files[p];
};

const HOST = Math.max(1, os.cpus().length);

test("a container's quota is what the run believes, not the host's count", () => {
  // This pod, exactly: 4 cores of a 16-core node.
  assert.equal(cpuAllowance(kernel({ "/sys/fs/cgroup/cpu.max": "400000 100000\n" })), 4);
  assert.equal(cpuAllowance(kernel({ "/sys/fs/cgroup/cpu.max": "150000 100000\n" })), 1, "a fraction rounds down, never to zero");
});

test("no quota means the host's processors — a plain machine is not throttled", () => {
  assert.equal(cpuAllowance(kernel({ "/sys/fs/cgroup/cpu.max": "max 100000\n" })), HOST);
  assert.equal(cpuAllowance(kernel({})), HOST, "and a kernel that writes neither file answers the same");
});

test("the older cgroup writes the same quota in two files", () => {
  assert.equal(
    cpuAllowance(
      kernel({
        "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "200000\n",
        "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
      }),
    ),
    2,
  );
  assert.equal(
    cpuAllowance(kernel({ "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "-1\n", "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n" })),
    HOST,
    "-1 is the older kernel's way of saying no limit",
  );
});

test("children are told the truth, and a deliberate setting is left alone", () => {
  const told = withCpuTruth({ PATH: "/usr/bin" }, 4);
  assert.equal(told.GOMAXPROCS, "4", "Go's scheduler — esbuild and anything else built in Go");
  assert.equal(told.UV_THREADPOOL_SIZE, "4", "libuv's pool — node's file and compression work");
  assert.equal(told.PATH, "/usr/bin", "and everything else is carried through untouched");

  const chosen = withCpuTruth({ GOMAXPROCS: "1" }, 4);
  assert.equal(chosen.GOMAXPROCS, "1", "a value someone set on purpose is never overwritten");
});

test("the run takes half of what it is granted, and leaves the rest answering", () => {
  assert.equal(unitsAtOnce(4), 2, "this pod: two units, two processors left for the editor and the driver");
  assert.equal(unitsAtOnce(2), 1, "a smaller container gets one, where the old fixed two would have starved it");
  assert.equal(unitsAtOnce(1), 1, "never zero");
  assert.equal(unitsAtOnce(64), 4, "and a large machine is capped: more units is not more throughput here");
});
