/**
 * Migration test (SP-th8m5b / TEP-th8lzj, AC 6 — slice SP-th8m5b_SL-3).
 *
 * Runs the one-shot `scripts/migrate-ids.mjs` against a tmpdir fixture of
 * base36-epoch data (the repo's `scripts/*-harness.mjs` pattern, but driven from
 * `node --test`) and asserts the produced tree:
 *
 *   1. sequential numbers are assigned in epoch-creation order, and FROZEN into
 *      frontmatter — and the migration is idempotent (a 2nd run is a no-op,
 *      yielding a byte-identical tree);
 *   2. no base36-epoch directory name or frontmatter id survives anywhere;
 *   3. every `implements:` cross-link still resolves to its target TEP — both a
 *      bare ref (local) and a qualified, org-deepened cross-board ref.
 *
 * Plus a focused check that the `spec/SP-<base36>` git branches are renamed to
 * the tep-qualified `spec/TEP-n_SP-m` form.
 *
 * Pure node builtins — no vscode. The script under test is plain ESM JS, so this
 * spawns it as a child process rather than importing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── locate the script under test (works from out-test/ and a manual build) ──
function findScript(): string {
  const candidates: string[] = [];
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, "scripts", "migrate-ids.mjs"));
    dir = path.dirname(dir);
  }
  candidates.push(path.join(process.cwd(), "scripts", "migrate-ids.mjs"));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("could not locate scripts/migrate-ids.mjs");
}
const SCRIPT = findScript();

/** Encode an epoch-seconds value to the legacy base36-epoch id form. */
function enc(epoch: number): string {
  return epoch.toString(36).padStart(6, "0");
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Recursively map every file under `root` to its text content (relpath → text). */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else
        out.set(
          path.relative(root, abs).split(path.sep).join("/"),
          fs.readFileSync(abs, "utf8"),
        );
    }
  };
  walk(root);
  return out;
}

/** Every directory and file NAME under `root`. */
function allNames(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      out.push(e.name);
      if (e.isDirectory()) walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

function fmValue(content: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(content);
  if (!m) return undefined;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function runMigrate(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

// ── fixture epochs (ascending → recovered creation order) ──
const E = {
  tepA: 1_700_000_000, // earliest TEP → TEP-1
  tepB: 1_700_000_100, // later TEP → TEP-2
  s2: 1_700_000_010, // under tepA, earlier → SP-1
  s1: 1_700_000_050, // under tepA, later → SP-2
  s3: 1_700_000_200, // under tepB → SP-1
  tepP: 1_700_000_500, // project umbrella TEP → TEP-1 (in the project ns)
  s4: 1_700_000_600, // cross-board member spec implementing the project TEP
};

/**
 * The org-agnostic `TEP-TEMPLATE.md` scaffold (modeled on the live ai-integration
 * board's). Its `TEP-NNNN` placeholder is NOT a number/epoch id and must survive
 * the migration byte-for-byte — `write_tep` scaffolds new TEPs from it post-cutover.
 */
const TEMPLATE_CONTENT =
  `---\nkind: tep\nid: TEP-NNNN\ntitle: <concise imperative title>\n` +
  `status: proposed\nimplemented_by: []\n---\n\n` +
  `# TEP-NNNN — <title>\n\n## Goal\n\n_Fill me in._\n`;

/** Seed a full base36-epoch board fixture under a fresh tmp dir; return its paths. */
function seedFixture(): { board: string; oldIds: string[] } {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-ids-"));
  const repoNs = path.join(board, "Apps", "widgets-app");
  const projNs = path.join(board, "Platform", "projects", "delivery");

  const id = {
    tepA: enc(E.tepA),
    tepB: enc(E.tepB),
    s1: enc(E.s1),
    s2: enc(E.s2),
    s3: enc(E.s3),
    tepP: enc(E.tepP),
    s4: enc(E.s4),
  };

  // ── repo namespace: two TEPs, three local specs + one cross-board member ──
  write(
    path.join(repoNs, "teps", `TEP-${id.tepA}.md`),
    `---\nkind: tep\nstatus: accepted\nimplemented_by:\n  - SP-${id.s1}\n  - SP-${id.s2}\n---\n\n# First enhancement\n\nThe earliest proposal.\n`,
  );
  write(
    path.join(repoNs, "teps", `TEP-${id.tepB}.md`),
    `---\nkind: tep\nstatus: accepted\n---\n\n# Second enhancement\n\nA later proposal.\n`,
  );
  // The org-agnostic TEP template sits beside the numbered TEPs (as on the live
  // ai-integration board) — the migration must relocate it to the fixed
  // board-level path, never renumber it, and leave its TEP-NNNN placeholder.
  write(path.join(repoNs, "teps", "TEP-TEMPLATE.md"), TEMPLATE_CONTENT);

  const specBody = (title: string) =>
    `# ${title}\n\n## Acceptance Criteria\n\n- [ ] something\n\n## Constraints\n\n- none\n\n## Design\n\n- n/a\n\n## File Structure Plan\n\n- n/a\n`;

  // S1 (later) and S2 (earlier) both implement TEP A (bare, local).
  write(
    path.join(repoNs, "specs", `SP-${id.s1}`, "spec.md"),
    `---\nkind: spec\nimplements: TEP-${id.tepA}\n---\n\n${specBody("Spec one")}`,
  );
  write(
    path.join(repoNs, "specs", `SP-${id.s1}`, "SL-1.md"),
    `---\nkind: slice\nparent: SP-${id.s1}\nstatus: ready\n---\n\n# Slice one of spec one\n`,
  );
  // SL-2 depends on a slice in the SIBLING spec S2 → must remap to the new handle.
  write(
    path.join(repoNs, "specs", `SP-${id.s1}`, "SL-2.md"),
    `---\nkind: slice\nparent: SP-${id.s1}\nstatus: ready\ndepends_on:\n  - SP-${id.s2}_SL-1\n---\n\n# Slice two of spec one\n`,
  );
  write(
    path.join(repoNs, "specs", `SP-${id.s2}`, "spec.md"),
    `---\nkind: spec\nimplements: TEP-${id.tepA}\n---\n\n${specBody("Spec two")}`,
  );
  write(
    path.join(repoNs, "specs", `SP-${id.s2}`, "SL-1.md"),
    `---\nkind: slice\nparent: SP-${id.s2}\nstatus: ready\n---\n\n# Slice one of spec two\n`,
  );
  // S3 implements TEP B (bare, local).
  write(
    path.join(repoNs, "specs", `SP-${id.s3}`, "spec.md"),
    `---\nkind: spec\nimplements: TEP-${id.tepB}\n---\n\n${specBody("Spec three")}`,
  );
  write(
    path.join(repoNs, "specs", `SP-${id.s3}`, "SL-1.md"),
    `---\nkind: slice\nparent: SP-${id.s3}\nstatus: ready\n---\n\n# Slice one of spec three\n`,
  );
  // S4 is a cross-board member: it implements the PROJECT umbrella TEP via a
  // qualified ref (no org segment yet — that's what migration inserts).
  write(
    path.join(repoNs, "specs", `SP-${id.s4}`, "spec.md"),
    `---\nkind: spec\nimplements: Platform/projects/delivery:TEP-${id.tepP}\n---\n\n${specBody("Cross-board member spec")}`,
  );
  write(
    path.join(repoNs, "specs", `SP-${id.s4}`, "SL-1.md"),
    `---\nkind: slice\nparent: SP-${id.s4}\nstatus: ready\n---\n\n# Member slice\n`,
  );

  // A decision file — preserved (sequential ADR id, never base36-epoch).
  write(
    path.join(repoNs, "decisions", "ADR-0001.md"),
    "# A decision\n\nKept across the migration.\n",
  );

  // ── project namespace: the umbrella TEP only (code-less) ──
  write(
    path.join(projNs, "teps", `TEP-${id.tepP}.md`),
    `---\nkind: tep\nstatus: accepted\n---\n\n# Project umbrella\n\nThe cross-board why.\n`,
  );

  return { board, oldIds: Object.values(id) };
}

test("migration assigns frozen sequential numbers in epoch order and is idempotent", () => {
  const { board } = seedFixture();
  try {
    const r1 = runMigrate(["--board", board, "--org", "Acme"]);
    assert.equal(r1.status, 0, `migrate failed: ${r1.stderr || r1.stdout}`);

    const teps = path.join(board, "Apps", "widgets-app", "Acme", "teps");

    // Epoch order: tepA (earliest) → TEP-1, tepB → TEP-2.
    const tep1 = fs.readFileSync(path.join(teps, "TEP-1", "tep.md"), "utf8");
    const tep2 = fs.readFileSync(path.join(teps, "TEP-2", "tep.md"), "utf8");
    assert.match(tep1, /# First enhancement/);
    assert.match(tep2, /# Second enhancement/);

    // Frozen ids in frontmatter match the directory numbers.
    assert.equal(fmValue(tep1, "id"), "TEP-1");
    assert.equal(fmValue(tep2, "id"), "TEP-2");

    // Per-TEP spec numbering follows epoch order: under TEP-1, S2 (earlier) is
    // SP-1 and S1 (later) is SP-2.
    const sp1 = fs.readFileSync(
      path.join(teps, "TEP-1", "SP-1", "spec.md"),
      "utf8",
    );
    const sp2 = fs.readFileSync(
      path.join(teps, "TEP-1", "SP-2", "spec.md"),
      "utf8",
    );
    assert.match(sp1, /# Spec two/);
    assert.match(sp2, /# Spec one/);
    assert.equal(fmValue(sp1, "id"), "SP-1");
    assert.equal(fmValue(sp2, "id"), "SP-2");

    // Spec numbering restarts per TEP: S3 under TEP-2 is SP-1.
    const sp1UnderB = fs.readFileSync(
      path.join(teps, "TEP-2", "SP-1", "spec.md"),
      "utf8",
    );
    assert.match(sp1UnderB, /# Spec three/);

    // implemented_by on TEP-1 was remapped to the new spec handles (S1→SP-2, S2→SP-1).
    assert.match(tep1, /SP-1/);
    assert.match(tep1, /SP-2/);

    // depends_on on S1/SL-2 remapped to the tep-qualified handle of S2/SL-1.
    const sl2 = fs.readFileSync(
      path.join(teps, "TEP-1", "SP-2", "SL-2.md"),
      "utf8",
    );
    assert.match(sl2, /TEP-1_SP-1_SL-1/);

    // Decision preserved under the org segment.
    assert.ok(
      fs.existsSync(
        path.join(
          board,
          "Apps",
          "widgets-app",
          "Acme",
          "decisions",
          "ADR-0001.md",
        ),
      ),
      "ADR preserved under <org>/decisions",
    );

    // The org-agnostic template is relocated to the FIXED board-level path
    // (`<ns>/teps/TEP-TEMPLATE.md`, NOT under <org>/), byte-for-byte unchanged —
    // its TEP-NNNN placeholder intact and never parsed/renumbered.
    const tmplPath = path.join(
      board,
      "Apps",
      "widgets-app",
      "teps",
      "TEP-TEMPLATE.md",
    );
    assert.ok(fs.existsSync(tmplPath), "template not relocated to board level");
    assert.equal(
      fs.readFileSync(tmplPath, "utf8"),
      TEMPLATE_CONTENT,
      "template content changed",
    );
    assert.equal(fmValue(fs.readFileSync(tmplPath, "utf8"), "id"), "TEP-NNNN");
    // The template never landed under <org>/ …
    assert.ok(
      !fs.existsSync(path.join(teps, "TEP-TEMPLATE", "tep.md")),
      "template wrongly nested under <org>/teps",
    );
    assert.ok(
      !fs.existsSync(path.join(teps, "TEP-TEMPLATE.md")),
      "template wrongly placed under <org>/teps",
    );
    // … and no numbered TEP-n leaked into the board-level teps/ alongside it.
    const boardTeps = fs.readdirSync(
      path.join(board, "Apps", "widgets-app", "teps"),
    );
    assert.deepEqual(
      boardTeps,
      ["TEP-TEMPLATE.md"],
      `board-level teps/ should hold only the template, got ${boardTeps.join(", ")}`,
    );

    // Idempotent: a 2nd run is a no-op → byte-identical tree.
    const before = snapshot(board);
    const r2 = runMigrate(["--board", board, "--org", "Acme"]);
    assert.equal(
      r2.status,
      0,
      `second migrate failed: ${r2.stderr || r2.stdout}`,
    );
    const after = snapshot(board);
    assert.deepEqual(
      [...after.entries()].sort(),
      [...before.entries()].sort(),
      "tree changed on re-run",
    );
  } finally {
    fs.rmSync(board, { recursive: true, force: true });
  }
});

test("migration leaves no base36-epoch directory name or frontmatter id behind", () => {
  const { board, oldIds } = seedFixture();
  try {
    const r = runMigrate(["--board", board, "--org", "Acme"]);
    assert.equal(r.status, 0, `migrate failed: ${r.stderr || r.stdout}`);

    // No directory/file name anywhere mentions an old base36-epoch id.
    const names = allNames(board);
    for (const oldId of oldIds) {
      for (const n of names) {
        assert.ok(
          !n.includes(oldId),
          `old id ${oldId} survives in a name: ${n}`,
        );
      }
    }
    // No file CONTENT (frontmatter id / implements / depends_on) mentions one.
    for (const [rel, content] of snapshot(board)) {
      for (const oldId of oldIds) {
        assert.ok(
          !content.includes(oldId),
          `old id ${oldId} survives in ${rel}`,
        );
      }
    }
    // The old flat dirs are gone entirely. The board-level `teps/` survives,
    // but ONLY to hold the org-agnostic template — no numbered/epoch TEP files.
    assert.ok(
      !fs.existsSync(path.join(board, "Apps", "widgets-app", "specs")),
      "old specs/ remains",
    );
    assert.deepEqual(
      fs.readdirSync(path.join(board, "Apps", "widgets-app", "teps")),
      ["TEP-TEMPLATE.md"],
      "old flat teps/ should be emptied of everything but the template",
    );
  } finally {
    fs.rmSync(board, { recursive: true, force: true });
  }
});

test("every implements: cross-link still resolves after migration", () => {
  const { board } = seedFixture();
  try {
    const r = runMigrate(["--board", board, "--org", "Acme"]);
    assert.equal(r.status, 0, `migrate failed: ${r.stderr || r.stdout}`);

    // Resolve every spec.md's implements: to an existing tep.md (last-colon split).
    const specDocs: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name === "spec.md") specDocs.push(abs);
      }
    };
    walk(board);
    assert.equal(specDocs.length, 4, "expected 4 migrated specs");

    let sawBare = 0;
    let sawQualified = 0;
    for (const specPath of specDocs) {
      const impl = fmValue(fs.readFileSync(specPath, "utf8"), "implements");
      assert.ok(impl, `spec ${specPath} lost its implements:`);
      const idx = impl!.lastIndexOf(":");
      let tepDoc: string;
      let expectId: string;
      if (idx > 0) {
        // Qualified, org-deepened cross-board ref: <namespace>:TEP-n
        sawQualified++;
        const ns = impl!.slice(0, idx).trim();
        const tepId = impl!
          .slice(idx + 1)
          .trim()
          .replace(/^TEP-/, "");
        expectId = `TEP-${tepId}`;
        tepDoc = path.join(
          board,
          ...ns.split("/"),
          "teps",
          `TEP-${tepId}`,
          "tep.md",
        );
        // The org segment must be present in the deepened namespace.
        assert.match(ns, /\/Acme$/, `qualified ref not org-deepened: ${impl}`);
      } else {
        // Bare ref: resolves within the spec's own (board, org) — the TEP folder
        // that the spec sits inside.
        sawBare++;
        const tepId = impl!.trim().replace(/^TEP-/, "");
        expectId = `TEP-${tepId}`;
        tepDoc = path.join(path.dirname(path.dirname(specPath)), "tep.md");
        // and the bare number matches the enclosing TEP-n folder name.
        assert.equal(
          path.basename(path.dirname(path.dirname(specPath))),
          `TEP-${tepId}`,
        );
      }
      assert.ok(
        fs.existsSync(tepDoc),
        `implements ${impl} → missing ${tepDoc}`,
      );
      assert.equal(
        fmValue(fs.readFileSync(tepDoc, "utf8"), "id"),
        expectId,
        `target id mismatch for ${impl}`,
      );
    }
    assert.ok(sawBare >= 3, "expected the local specs to use bare refs");
    assert.equal(sawQualified, 1, "expected one cross-board qualified ref");
  } finally {
    fs.rmSync(board, { recursive: true, force: true });
  }
});

test("migration renames spec/SP-<base36> git branches to the tep-qualified form", () => {
  const { board } = seedFixture();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-ids-repo-"));
  try {
    const git = (...a: string[]) =>
      execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
    execFileSync("git", ["init", "-q", repo], { stdio: "ignore" });
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(repo, "README.md"), "x\n");
    git("add", ".");
    git("commit", "-qm", "init");

    // A branch for S1 (which becomes TEP-1 / SP-2) and S3 (TEP-2 / SP-1).
    git("branch", `spec/SP-${enc(E.s1)}`);
    git("branch", `spec/SP-${enc(E.s3)}`);

    const r = runMigrate(["--board", board, "--org", "Acme", "--repo", repo]);
    assert.equal(r.status, 0, `migrate failed: ${r.stderr || r.stdout}`);

    const branches = execFileSync(
      "git",
      ["-C", repo, "branch", "--format=%(refname:short)"],
      {
        encoding: "utf8",
      },
    );
    assert.match(branches, /spec\/TEP-1_SP-2/, "S1 branch not renamed");
    assert.match(branches, /spec\/TEP-2_SP-1/, "S3 branch not renamed");
    assert.ok(!branches.includes(enc(E.s1)), "old S1 branch survives");
    assert.ok(!branches.includes(enc(E.s3)), "old S3 branch survives");
  } finally {
    fs.rmSync(board, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveOrg fails fast when git user.name is unset and no --org is given", () => {
  // A board dir whose git user.name resolves empty (no repo / unset) → fail-fast,
  // no default org. We point HOME/GIT envs at an empty dir so no global name leaks.
  const { board } = seedFixture();
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-ids-home-"));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, "--board", board], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: emptyHome,
        XDG_CONFIG_HOME: emptyHome,
        GIT_CONFIG_GLOBAL: path.join(emptyHome, "nonexistent"),
        GIT_CONFIG_SYSTEM: path.join(emptyHome, "nonexistent"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "",
        GIT_COMMITTER_NAME: "",
      },
    });
    assert.notEqual(
      r.status,
      0,
      "expected a non-zero exit when org cannot be resolved",
    );
    assert.match(
      (r.stderr ?? "") + (r.stdout ?? ""),
      /organization|user\.name/i,
    );
  } finally {
    fs.rmSync(board, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});
