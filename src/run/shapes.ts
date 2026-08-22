/**
 * The repository shapes the machine claims to work in, as tiny real
 * repositories — and workers that misbehave on purpose.
 *
 * The machine's whole contract with a repository is four facts it measures
 * at the door: how to install, how to build (or that there is no build),
 * how one test runs (or that only the whole suite does), and where build
 * output lands (or that nothing is emitted). Everything downstream — the
 * check audit, the runners, the scoped suite — is derived from those.
 *
 * Until now every test used one shape (no build, no output), which is why
 * regressions that depend on the OTHER shapes reached the field instead of
 * the suite. These fixtures are shell scripts, not toolchains: no language
 * is privileged, and a shape is reproduced in milliseconds.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { WorkerOutcome } from "./worker";

export interface RepoShape {
  /** What the shape is, in the words the door would use. */
  name: string;
  /** The build command, or "" when a repository has none. */
  prepare: string;
  /** How one test file runs (`<file>` = its source path), or "". */
  runOne: string;
  /** Where a source file lands once built — undefined when nothing is emitted. */
  built?: (source: string) => string;
}

/** A source file lands at itself: nothing is compiled (Python, plain JS). */
const FROM_SOURCE: RepoShape = {
  name: "no build — tests run from source",
  prepare: "",
  runOne: "node --test <file>",
};

/** The built tree mirrors the source tree with its first directory dropped. */
export const MIRROR_STRIPPED: RepoShape = {
  name: "build mirrors source, the leading directory dropped",
  prepare: "sh build.sh",
  runOne: 'node --test "out/$(echo <file> | sed -e \'s#^src/##\')"',
  built: (s) => `out/${s.replace(/^src\//, "")}`,
};

/** The built tree mirrors the source tree, prefix kept. */
const MIRROR_KEPT: RepoShape = {
  name: "build mirrors source, the leading directory kept",
  prepare: "sh build.sh",
  runOne: "node --test out/<file>",
  built: (s) => `out/${s}`,
};

/** A build with no per-file mapping and no way to run one test alone. */
const WHOLE_SUITE_ONLY: RepoShape = {
  name: "a build, and only the whole suite runs",
  prepare: "sh build.sh",
  runOne: "",
};

export const SHAPES: readonly RepoShape[] = [FROM_SOURCE, MIRROR_STRIPPED, MIRROR_KEPT, WHOLE_SUITE_ONLY];

/**
 * A real git repository in the given shape: a couple of source files, one
 * standing test of its own, and a build script that emits where the shape
 * says. Everything is `sh` and `cp` — the machine must not care.
 */
export function repoInShape(
  shape: RepoShape,
  opts: {
    standingRed?: boolean;
    /** A standing test that imports a module THIS RUN will create: red
     *  until that unit lands it, and red in the words the machine reads as
     *  "the tree is not ready yet" — the only red that makes a unit wait. */
    waitsFor?: string;
  } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-shape-"));
  const g = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  write("README.md", `${shape.name}\n`);
  write("src/hello.mjs", `export function hello() { return "hi"; }\n`);
  write("src/util/pad.mjs", `export const pad = (s) => ` + "`[${s}]`" + `;\n`);
  write(
    "src/hello.test.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { hello } from "./hello.mjs";\ntest("hello", () => assert.equal(hello(), "hi"));\n`,
  );
  // A standing test that is already red for a reason no unit of this run
  // owns — one slice's in-flight change, in a file nobody here may edit.
  if (opts.standingRed)
    write(
      "src/gate.test.mjs",
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
        `test("the signing gate refuses a cut with no documentation", () => assert.equal(1, 2));\n`,
    );
  if (opts.waitsFor)
    write(
      "src/link.test.mjs",
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
        `import { thing } from "../${opts.waitsFor}";\ntest("linked", () => assert.ok(thing()));\n`,
    );
  if (shape.prepare) {
    // A real build: it mirrors whatever the tree holds, including files the
    // run has not written yet — a fixture that only copies known files
    // would test the machine against a world that cannot change.
    const strip = (shape.built?.("src/x.mjs") ?? "").includes("out/x.mjs") ? "s#^src/##" : "s#^##";
    write(
      "build.sh",
      "#!/bin/sh\nset -e\n" +
        "find src -name '*.mjs' 2>/dev/null | while read -r f; do\n" +
        `  rel=$(echo "$f" | sed -e '${strip}')\n` +
        '  mkdir -p "out/$(dirname "$rel")"\n' +
        '  cp "$f" "out/$rel"\n' +
        "done\n",
    );
    write(".gitignore", "out/\n");
  }
  g(["add", "-A"]);
  g(["commit", "-qm", "seed"]);
  return dir;
}

/**
 * Workers that go wrong the way real ones do. Every failure the run has
 * met in the field is one of these, and each is a fixture the ladder must
 * survive — not a story about what a model might do.
 */
export type Personality =
  | "honest"
  /** Writes a check importing a path nothing will ever create. */
  | "wrong-import"
  /** Writes a check that fakes a platform the repository does not own. */
  | "simulator"
  /** Its code never satisfies the check, and never changes either. */
  | "unchanging"
  /** Writes a file it does not own. */
  | "trespasser";

export interface ScriptedWorker {
  worker: (deps: { role: string; worktree: string; footprint: string[] }, brief: string) => Promise<WorkerOutcome>;
  /** What each unit was asked to do, for the assertions. */
  briefs: { unit: string; brief: string }[];
}

/** A worker that plays a part, over a repository in a known shape. */
export function scriptedWorker(shape: RepoShape, how: Personality, closerFixes = true): ScriptedWorker {
  const briefs: { unit: string; brief: string }[] = [];
  const built = (s: string) => shape.built?.(s) ?? s;
  const write = (root: string, rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  return {
    briefs,
    worker: async (deps, brief) => {
      briefs.push({ unit: deps.footprint[0] ?? "?", brief });
      const closing = /You are the CLOSER/.test(brief);
      if (closing && closerFixes) {
        write(deps.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "UNDELIVERED: none" };
      }
      if (deps.role === "test" && deps.footprint.some((f) => f.startsWith("probes/"))) {
        for (const rel of deps.footprint.filter((f) => f.startsWith("probes/"))) {
          const target = built("src/greet.mjs");
          const body =
            how === "wrong-import"
              ? `import { greet } from "../${built("src/src/greet.mjs")}";\n` +
                `import { test } from "node:test";\ntest("greet", () => greet());\n`
              : how === "simulator"
                ? `import Module from "node:module";\nModule._load = () => ({ greet: () => "hello" });\n` +
                  `import { test } from "node:test";\ntest("greet", () => {});\n`
                : `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
                  `import { greet } from "../${target}";\ntest("greet", () => assert.equal(greet(), "hello"));\n`;
          write(deps.worktree, rel, body);
        }
        return { ok: true, finalText: "done" };
      }
      if (how === "trespasser") write(deps.worktree, "src/not-mine.mjs", "// not mine\n");
      write(
        deps.worktree,
        "src/greet.mjs",
        how === "unchanging"
          ? `export function greet() { return "not hello"; }\n`
          : `export function greet() { return "hello"; }\n`,
      );
      return { ok: true, finalText: "done" };
    },
  };
}
