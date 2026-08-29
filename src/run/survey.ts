/**
 * What kind of target a repository is — read from the repository, decided
 * by evidence, asked of nobody.
 *
 * The platform has five shapes, and Tandem's job differs downstream of the
 * merge in each: an app in `apps/` fires the whole gitops pipeline on push
 * (webhook → Argo test-in-image → Kaniko → Harbor → ArgoCD); a template is
 * validated by deploying it through thinkube-control; thinkube-control
 * itself is a copier template deployed by an ansible component; the
 * playbook repo validates on the live cluster via each component's
 * `18_test.yaml`; the installer is a package a person must install to
 * truly verify. Meta-development (this extension) is the plain case:
 * everything happens here.
 *
 * One word is persisted — `downstream` — because it has no other home.
 * Everything specific (test commands, images, playbook paths) stays in its
 * authoritative source and is read at the moment of use.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { thinkubeDeclaration } from "../core/thinkubeYaml";
import { ignoredFor, worthWalking } from "../core/ignored";

export type Downstream =
  | "gitops-app" //   push to the platform Gitea fires test→build→deploy
  | "template" //     validated by deploying it through thinkube-control
  | "ansible-component" // a copier template deployed by a core component
  | "ansible" //      playbooks; validated on the live cluster (18_test)
  | "package" //      built into an installable; validated by a person
  | "script"; //      everything local — the meta-development case

/** A part of the project: its own root, its own toolchain. */
interface Part {
  /** Repository-relative root, "/"-separated; "." is the whole repo. */
  root: string;
  /** Where the part was found — the evidence, for the person to read. */
  from: "thinkube.yaml" | "nested-manifest" | "root";
}

function remoteOf(repoRoot: string): string {
  try {
    return execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function isTemplateManifest(repoRoot: string): boolean {
  try {
    const doc = parseYaml(fs.readFileSync(path.join(repoRoot, "manifest.yaml"), "utf8")) as {
      kind?: string;
    };
    return doc?.kind === "TemplateManifest";
  } catch {
    return false;
  }
}

function hasComponentTests(repoRoot: string): boolean {
  const base = path.join(repoRoot, "ansible");
  if (!fs.existsSync(base)) return false;
  const walk = (dir: string, depth: number): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (e.isFile() && /^18_test.*\.ya?ml$/.test(e.name)) return true;
      if (e.isDirectory() && depth < 4 && walk(path.join(dir, e.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(base, 0);
}

/**
 * Which downstream the merge sets in motion. Order matters: an app in
 * `apps/` still carries the template's `manifest.yaml` it was copied from,
 * so the remote decides first.
 */
export function downstreamOf(repoRoot: string): Downstream {
  if (/\/thinkube-deployments\//.test(remoteOf(repoRoot))) return "gitops-app";
  if (fs.existsSync(path.join(repoRoot, "copier.yaml"))) return "ansible-component";
  if (isTemplateManifest(repoRoot) && fs.existsSync(path.join(repoRoot, "thinkube.yaml")))
    return "template";
  if (hasComponentTests(repoRoot)) return "ansible";
  if (
    fs.existsSync(path.join(repoRoot, "src-tauri")) ||
    fs.existsSync(path.join(repoRoot, "frontend", "src-tauri"))
  )
    return "package";
  return "script";
}

/**
 * The parts a project is made of.
 *
 * A container is a part (control's backend and frontend; each `todo`
 * container). A nested manifest with its own lockfile is a part (this
 * extension's `webview/map`) — which is why one repository can need two
 * install commands and two test runners, and why a single repo-wide
 * `runOne` was wrong for every two-language project.
 */
export function partsOf(repoRoot: string): Part[] {
  const declared = thinkubeDeclaration(repoRoot);
  if (declared && "declared" in declared && declared.declared.containers.length)
    return declared.declared.containers.map((c) => ({
      root: path.posix.normalize(c.build.replace(/^\.\//, "")) || ".",
      from: "thinkube.yaml" as const,
    }));
  const parts: Part[] = [{ root: ".", from: "root" }];
  const skip = ignoredFor(repoRoot);
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || !worthWalking(e.name, skip) || e.name.startsWith(".")) continue;
      const sub = path.join(dir, e.name);
      const manifest = fs.existsSync(path.join(sub, "package.json"));
      const lock = fs.existsSync(path.join(sub, "package-lock.json"));
      if (manifest && lock)
        parts.push({
          root: path.relative(repoRoot, sub).split(path.sep).join("/"),
          from: "nested-manifest",
        });
      else if (depth < 2) walk(sub, depth + 1);
    }
  };
  walk(repoRoot, 0);
  return parts;
}
