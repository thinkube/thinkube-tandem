/**
 * What counts as a test-shaped or probe-shaped path — the one rule the rest
 * of the machine reads: the adapter, the write fence, the read block, the
 * blast-radius fold, re-homing, and the import-impact gate alike. A second
 * definition anywhere breaks all of them at once.
 */

/** Files a test runner can execute — any ecosystem, never one language's.
 *  A configuration or a document is never a test, whatever its name says:
 *  `tsconfig.test.json` is a compiler's config, not a check. */
const RUNNABLE = /\.(m|c)?[jt]sx?$|\.(py|rb|go|rs|java|kt|kts|php|cs|swift|scala|ex|exs|sh|bash|lua|dart|pl|pm)$/i;

/** Any test-shaped path — by the conventions test files are named and
 *  housed under across ecosystems, never by one language's extension: a
 *  `.test`/`.spec` file, a `test_*`/`*_test` file, anything under a tests
 *  directory, a probe, held-out acceptance. Only a file a runner could
 *  execute qualifies — a name is not enough. */
export function isTestPath(rel: string): boolean {
  const t = rel.replace(/\\/g, "/");
  if (/(^|[\s/])probes\//.test(t) || /(^|\/)acceptance\//.test(t)) return true;
  if (!RUNNABLE.test(t)) return false;
  return (
    /(^|\/)(tests?|__tests__|spec)\//.test(t) ||
    /\.(test|spec)[._-][^/]*$/.test(t) ||
    /(^|\/)test_[^/]*$/.test(t) ||
    /_test\.[^/.]+$/.test(t)
  );
}

/**
 * A check this run authored — held-out evidence, never a test home the
 * repository maintains.
 *
 * A check is known by the criterion in its name (`_AC-3`), not by the
 * directory it sits in, because a check is now born beside the module it
 * drives. The old `probes/` coordinate still reads as a check, so a branch
 * an earlier run left half-finished still parses.
 */
export function isProbePath(rel: string): boolean {
  const t = rel.replace(/\\/g, "/");
  if (/(^|[\s/])probes\//.test(t) || /(^|\/)acceptance\//.test(t)) return true;
  return /_AC-\d+/.test(t) && isTestPath(t);
}
