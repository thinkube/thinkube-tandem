/**
 * Product/Project manifest writers (SP-tgvl81_SL-3). Pure `fs` + `yaml` (no
 * vscode) so the path + content are unit-testable vscode-free; the command
 * wrappers (input prompts + refresh) live in `products.ts`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";

/** Slugify a display name into a directory id (lowercase, dash-separated). */
export function slugifyId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Write `<boardRoot>/<id>/product.yaml`; returns the file path. */
export async function writeProductManifest(
  boardRoot: string,
  product: { id: string; name: string },
): Promise<string> {
  const dir = path.join(boardRoot, product.id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "product.yaml");
  await fs.writeFile(file, yamlStringify({ name: product.name }), "utf8");
  return file;
}

/**
 * Write `<boardRoot>/<product>/projects/<id>/project.yaml`; returns the file
 * path. A Project is a code-less umbrella — its manifest is just `name`/`state`
 * (membership is by `implements:`, not a tag — SP-tgvpbm).
 */
export async function writeProjectManifest(
  boardRoot: string,
  product: string,
  project: { id: string; name: string; state?: "open" | "done" },
): Promise<string> {
  const dir = path.join(boardRoot, product, "projects", project.id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "project.yaml");
  await fs.writeFile(
    file,
    yamlStringify({ name: project.name, state: project.state ?? "open" }),
    "utf8",
  );
  return file;
}
