/**
 * Pure view-model for the navigator Product tree (SP-tgvl81_SL-1 / TEP-tgvh8p).
 *
 * Groups the discovered repos under their Product and attaches each Product's
 * Projects. Pure (no vscode) so it's unit-testable; the navigator maps the
 * result to tree nodes and renders them. A repo belongs to a Product when the
 * first segment of its sidecar namespace equals the Product id; repos under no
 * Product fall into `ungroupedRepoPaths` (so nothing disappears).
 */
import type { Product } from "../../store/products";
import type { Project } from "../../store/projects";
import { parseImplements, resolvesTo } from "../../store/implementsRef";

export interface RepoRef {
  /** Absolute repo path (the key the navigator maps back to a RepoEntry). */
  path: string;
  /** The repo's sidecar namespace (`<container>/<rel>`), or undefined. */
  namespace?: string;
}

export interface ProjectDesc {
  product: string;
  id: string;
  name: string;
  state: "open" | "done";
  tag: string;
}

export interface ProductGroup {
  id: string;
  name: string;
  /** Member repo paths (subset of the input repos). */
  repoPaths: string[];
  projects: ProjectDesc[];
}

export interface ProductTree {
  products: ProductGroup[];
  /** Repo paths under no Product — still listed at top level. */
  ungroupedRepoPaths: string[];
}

export interface MemberItem {
  board: string;
  handle: string;
  kind: string;
  tags: string[];
}
export interface MemberDesc {
  board: string;
  handle: string;
  kind: string;
}

/**
 * A Project's members (SP-tgvl81_SL-2): the items carrying the project's `tag`.
 * Pure — the navigator's member view collects the tagged items host-side, then
 * filters them through here. Non-matching items are excluded.
 */
export function projectMembers(tag: string, items: MemberItem[]): MemberDesc[] {
  return items
    .filter((i) => i.tags.includes(tag))
    .map(({ board, handle, kind }) => ({ board, handle, kind }));
}

export interface SpecImpl {
  /** Board id (for display). */
  board: string;
  /** The spec's sidecar namespace (for resolving bare refs). */
  namespace: string;
  /** Spec handle, e.g. `SP-tgvc8v`. */
  handle: string;
  /** Raw `implements:` frontmatter value. */
  implements?: string;
}
export interface TepGroup {
  tepId: string;
  specs: { board: string; handle: string }[];
}

/**
 * Group the implementing specs under each umbrella TEP of a Project
 * (SP-tgvpbm_SL-4): a spec is under TEP `t` iff its `implements:` resolves to
 * `projectNamespace:t`. Pure — the navigator collects the specs host-side and
 * filters them through here for the Project ▸ TEP ▸ specs drill-down.
 */
export function projectTepGroups(
  projectNamespace: string,
  tepIds: string[],
  specs: SpecImpl[],
): TepGroup[] {
  return tepIds.map((tepId) => ({
    tepId,
    specs: specs
      .filter((s) => {
        const ref = parseImplements(s.implements);
        return !!ref && resolvesTo(ref, s.namespace, projectNamespace, tepId);
      })
      .map((s) => ({ board: s.board, handle: s.handle })),
  }));
}

export function buildProductTree(
  products: Product[],
  projects: Project[],
  repos: RepoRef[],
): ProductTree {
  const productIds = new Set(products.map((p) => p.id));

  const reposByProduct = new Map<string, string[]>();
  const ungroupedRepoPaths: string[] = [];
  for (const r of repos) {
    const seg = r.namespace ? r.namespace.split("/")[0] : undefined;
    if (seg && productIds.has(seg)) {
      const arr = reposByProduct.get(seg) ?? [];
      arr.push(r.path);
      reposByProduct.set(seg, arr);
    } else {
      ungroupedRepoPaths.push(r.path);
    }
  }

  const projectsByProduct = new Map<string, ProjectDesc[]>();
  for (const pr of projects) {
    const arr = projectsByProduct.get(pr.product) ?? [];
    arr.push({
      product: pr.product,
      id: pr.id,
      name: pr.name,
      state: pr.state,
      tag: pr.tag,
    });
    projectsByProduct.set(pr.product, arr);
  }

  return {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      repoPaths: reposByProduct.get(p.id) ?? [],
      projects: projectsByProduct.get(p.id) ?? [],
    })),
    ungroupedRepoPaths,
  };
}
