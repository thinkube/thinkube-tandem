/**
 * Projects in the v1 sense (SPEC Amendment 1): a bounded piece of WORK
 * that may touch several repositories — never code. A project lives in
 * the store at projects/<id>/project.yaml {name, product, state} with its
 * thinking spaces as sibling directories, exactly one level deeper than
 * before. Ids are minted once (slug + suffix) and never re-derived.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { mintId } from "./identity";

export interface WorkProject {
  id: string;
  name: string;
  product: string;
  state: "open" | "done";
}

function projectsHome(storeRoot: string): string {
  return path.join(storeRoot, "projects");
}

/** The directory a project's thinking spaces live in (its own dir). */
function workProjectDir(storeRoot: string, id: string): string {
  return path.join(projectsHome(storeRoot), id);
}

export function createWorkProject(
  storeRoot: string,
  product: string,
  name: string,
  mint: () => string = () => mintId(name).slice(-6),
): { ok: true; project: WorkProject } | { ok: false; reason: string } {
  if (!name.trim()) return { ok: false, reason: "a project needs a name" };
  if (!product.trim()) return { ok: false, reason: "a project is born under a product" };
  const id = `${mintId(name).replace(/-[0-9a-f]{6}$/, "")}-${mint()}`;
  const dir = workProjectDir(storeRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  const project: WorkProject = { id, name: name.trim(), product: product.trim(), state: "open" };
  fs.writeFileSync(
    path.join(dir, "project.yaml"),
    stringifyYaml({ name: project.name, product: project.product, state: project.state }),
  );
  return { ok: true, project };
}

export function listWorkProjects(storeRoot: string): WorkProject[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsHome(storeRoot), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WorkProject[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    try {
      const m = parseYaml(
        fs.readFileSync(path.join(projectsHome(storeRoot), e.name, "project.yaml"), "utf8"),
      ) as Record<string, unknown>;
      out.push({
        id: e.name,
        name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : e.name,
        product: typeof m.product === "string" ? m.product.trim() : "",
        state: m.state === "done" ? "done" : "open",
      });
    } catch {
      // A directory without a readable manifest is not a project.
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function setWorkProjectState(
  storeRoot: string,
  id: string,
  state: "open" | "done",
): { ok: boolean; reason?: string } {
  const file = path.join(workProjectDir(storeRoot, id), "project.yaml");
  try {
    const m = parseYaml(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(file, stringifyYaml({ ...m, state }));
    return { ok: true };
  } catch {
    return { ok: false, reason: `no project '${id}' in the store` };
  }
}

/**
 * The context scope of a project thinking space: which repositories this
 * thinking reads. Stored beside the space's records as scope.json — a
 * list of repository ids, editable any time.
 */
export function readContextScope(spaceDir: string): string[] {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(spaceDir, "scope.json"), "utf8")) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeContextScope(spaceDir: string, repoIds: string[]): void {
  fs.mkdirSync(spaceDir, { recursive: true });
  fs.writeFileSync(path.join(spaceDir, "scope.json"), JSON.stringify([...new Set(repoIds)], null, 2));
}
