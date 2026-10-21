/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which versions of the libraries a check touches the repository installs.
 *
 * A check can rely on behaviour one version of a library has and the
 * installed one does not — a router that flattened its routes in one
 * release and keeps them inside a wrapper in the next. A judge that does not
 * know the installed version rules on the library it remembers. The
 * versions are read from what the repository pins — a lockfile or a
 * requirements file — and a library no pin names is reported as unpinned,
 * never given a version.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The pin files read, in the words a missing one is reported in. */
const PIN_FILES = "uv.lock, poetry.lock, requirements*.txt, package-lock.json";

/** Distribution or package name → the version (or requirement) pinned,
 *  from the pin files of every directory from the check's own up to the
 *  tree's root — the nearest pin wins, as the nearest manifest installs. */
function pinsFor(tree: string, probe: string): { sources: string[]; pins: Map<string, string> } {
  const pins = new Map<string, string>();
  const sources: string[] = [];
  let dir = path.posix.dirname(probe);
  for (;;) {
    pinsIn(tree, dir === "." ? "" : dir, pins, sources);
    if (dir === "." || dir === "/" || dir === "") break;
    dir = path.posix.dirname(dir);
  }
  return { sources, pins };
}

function pinsIn(tree: string, dir: string, pins: Map<string, string>, sources: string[]): void {
  const rel = (f: string) => (dir ? `${dir}/${f}` : f);
  const at = (f: string) => path.join(tree, rel(f));
  for (const f of ["uv.lock", "poetry.lock"]) {
    if (!fs.existsSync(at(f))) continue;
    sources.push(rel(f));
    const text = fs.readFileSync(at(f), "utf8");
    for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
      const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
      const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
      if (name && version && !pins.has(norm(name))) pins.set(norm(name), `${version} (${rel(f)})`);
    }
  }
  for (const f of fs.readdirSync(path.join(tree, dir)).filter((n) => /^requirements.*\.txt$/.test(n)).sort()) {
    sources.push(rel(f));
    for (const raw of fs.readFileSync(at(f), "utf8").split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(line);
      if (!m || line.startsWith("-")) continue;
      const spec = m[3].replace(/;.*$/, "").trim();
      const exact = /^===?\s*([^\s,]+)$/.exec(spec);
      if (!pins.has(norm(m[1])))
        pins.set(norm(m[1]), exact ? `${exact[1]} (${rel(f)})` : `${spec || "any version"} — no exact version (${rel(f)})`);
    }
  }
  if (fs.existsSync(at("package-lock.json"))) {
    sources.push(rel("package-lock.json"));
    const lock = JSON.parse(fs.readFileSync(at("package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };
    for (const [key, v] of Object.entries(lock.packages ?? {})) {
      const name = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key)?.[1];
      if (name && v.version && !pins.has(norm(name))) pins.set(norm(name), `${v.version} (${rel("package-lock.json")})`);
    }
    for (const [name, v] of Object.entries(lock.dependencies ?? {}))
      if (v.version && !pins.has(norm(name))) pins.set(norm(name), `${v.version} (${rel("package-lock.json")})`);
  }
}

/** Python normalises distribution names (PEP 503); npm names are kept. */
function norm(name: string): string {
  return name.startsWith("@") ? name : name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** The external modules a source imports, and the repository-local
 *  modules it imports, by the source's language. */
function importsOf(rel: string, source: string): { external: string[]; local: string[] } {
  const external = new Set<string>();
  const local = new Set<string>();
  if (rel.endsWith(".py")) {
    for (const m of source.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/gm)) {
      for (const name of (m[1] ?? m[2]).split(",").map((s) => s.trim().split(/\s+/)[0])) {
        if (!name || name.startsWith(".")) continue;
        external.add(name);
        local.add(name);
      }
    }
  } else {
    for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
      if (m[1].startsWith(".") || m[1].startsWith("/")) local.add(m[1]);
      else external.add(m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0]);
    }
  }
  return { external: [...external], local: [...local] };
}

/** The repository file a local import names, when the tree holds one. */
function resolveLocal(tree: string, from: string, spec: string, python: boolean): string | undefined {
  const tries = python
    ? [spec.replace(/\./g, "/") + ".py", spec.replace(/\./g, "/") + "/__init__.py"]
    : ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"].map((ext) =>
        path.posix.normalize(path.posix.join(path.posix.dirname(from), spec + ext)),
      );
  return tries.find((rel) => fs.existsSync(path.join(tree, rel)) && fs.statSync(path.join(tree, rel)).isFile());
}

/**
 * The installed versions of the libraries a check touches: what the check
 * imports, and what the repository modules it imports import in turn. Read
 * from the tree the check runs in. Says plainly when the tree pins nothing,
 * and names each library no pin file names.
 */
export function installedVersions(tree: string, probe: string): string {
  const python = probe.endsWith(".py");
  const source = fs.readFileSync(path.join(tree, probe), "utf8");
  const top = importsOf(probe, source);
  const libs = new Set<string>();
  const localFiles: string[] = [];
  const consider = (rel: string, imports: { external: string[]; local: string[] }): void => {
    for (const spec of imports.local) {
      const hit = resolveLocal(tree, rel, spec, python);
      if (hit && !localFiles.includes(hit)) localFiles.push(hit);
    }
    for (const lib of imports.external)
      if (!python || !resolveLocal(tree, rel, lib, true)) libs.add(python ? lib.split(".")[0] : lib);
  };
  consider(probe, top);
  for (const rel of [...localFiles]) consider(rel, importsOf(rel, fs.readFileSync(path.join(tree, rel), "utf8")));
  const { sources, pins } = pinsFor(tree, probe);
  if (!sources.length)
    return `No installed version is known: this repository has none of ${PIN_FILES}, so the versions of ${[...libs].sort().join(", ") || "what the check imports"} cannot be read.`;
  const lines: string[] = [];
  const unpinned: string[] = [];
  for (const lib of [...libs].sort()) {
    const key = norm(lib);
    const hit = pins.get(key) ?? [...pins.entries()].find(([k]) => k.startsWith(`${key}-`))?.[1];
    if (hit) lines.push(`- ${lib}: ${hit}`);
    else unpinned.push(lib);
  }
  return (
    (lines.length ? lines.join("\n") : `None of the libraries the check touches is pinned in ${sources.join(", ")}.`) +
    (unpinned.length ? `\nNot pinned in ${sources.join(", ")} (the standard library, or installed some other way): ${unpinned.join(", ")}` : "")
  );
}
