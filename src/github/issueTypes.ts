/**
 * IssueClassifier — strategy seam between GitHub's native Issue Types and the
 * label-based fallback (`epic` / `story` / `spec` / `task`).
 *
 * Background (per §7.2 of the integration plan): GitHub introduced first-class
 * Issue Types as a per-repo feature alongside the existing label system. Not
 * every target repo will have them configured, so the kanban needs to work
 * either way. This module hides that distinction from `GitHubService`'s
 * callers — they pass `Kind` everywhere and let the classifier decide whether
 * that maps to an `issue_type` filter or a label filter at query time.
 *
 * Detection is per-repo, lazy, and cached in-memory for the lifetime of the
 * classifier — the first read against a repo runs a GraphQL probe; everything
 * after that uses the cached mode. Pass an Octokit-style GraphQL caller in so
 * we don't pin a transport here.
 */

export type Kind = "epic" | "story" | "spec" | "task";

export const KINDS: readonly Kind[] = ["epic", "story", "spec", "task"];

/**
 * "issue-types" — repo has Issue Types configured with all four of our kinds.
 * "labels"      — repo has none/partial Issue Types; we fall back to labels.
 */
export type ClassifierMode = "issue-types" | "labels";

/**
 * Minimal shape an issue must expose for classification. Production callers
 * pass GraphQL results; tests/mocks pass plain objects.
 */
export interface ClassifiableIssue {
  number: number;
  title?: string;
  body?: string | null;
  labels?: ReadonlyArray<{ name?: string | null }> | null;
  issueType?: { name?: string | null } | null;
}

/**
 * Type info returned by the Issue Types probe.
 */
export interface RepoIssueTypeInfo {
  mode: ClassifierMode;
  /** Map from our `Kind` to the repo's IssueType node id (only set when mode === 'issue-types'). */
  typeIds: Partial<Record<Kind, string>>;
}

/**
 * Transport-agnostic GraphQL caller. Anything that takes a query + variables
 * and returns the data. Provided by the caller (typically `GitHubService`)
 * so this module stays independent of any particular Octokit version.
 */
export type GraphQLCaller = <T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

const ISSUE_TYPES_PROBE = /* GraphQL */ `
  query ($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      issueTypes(first: 25) {
        nodes {
          id
          name
        }
      }
    }
  }
`;

interface ProbeResult {
  repository: {
    issueTypes: {
      nodes: Array<{ id: string; name: string }>;
    } | null;
  } | null;
}

export class IssueClassifier {
  private readonly cache = new Map<string, RepoIssueTypeInfo>();

  constructor(private readonly graphql: GraphQLCaller) {}

  /**
   * Returns the cached repo classification, probing once if needed. Probe
   * failures (no Issue Types feature, permission errors) fall back to the
   * label mode rather than throwing — the kanban still works, just with
   * less precision.
   */
  async modeFor(owner: string, name: string): Promise<RepoIssueTypeInfo> {
    const key = `${owner}/${name}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let info: RepoIssueTypeInfo;
    try {
      const data = await this.graphql<ProbeResult>(ISSUE_TYPES_PROBE, {
        owner,
        name,
      });
      const nodes = data?.repository?.issueTypes?.nodes ?? [];
      const typeIds: Partial<Record<Kind, string>> = {};
      for (const node of nodes) {
        const k = normalizeKind(node.name);
        if (k && !typeIds[k]) {
          typeIds[k] = node.id;
        }
      }
      const allFour = KINDS.every((k) => typeIds[k]);
      info = allFour
        ? { mode: "issue-types", typeIds }
        : { mode: "labels", typeIds: {} };
    } catch {
      info = { mode: "labels", typeIds: {} };
    }

    this.cache.set(key, info);
    return info;
  }

  /** Force a re-probe on next access (e.g. after a settings change). */
  invalidate(owner?: string, name?: string): void {
    if (owner && name) {
      this.cache.delete(`${owner}/${name}`);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Classify an issue without re-probing — caller already has `mode`.
   * Returns undefined when nothing matches (issue isn't part of our model).
   */
  classify(issue: ClassifiableIssue, mode: ClassifierMode): Kind | undefined {
    if (mode === "issue-types") {
      const k = normalizeKind(issue.issueType?.name ?? undefined);
      if (k) return k;
      // Issue Types repos may still have legacy unlabeled/unlinked issues;
      // try the label fallback so we don't silently lose those.
    }
    for (const label of issue.labels ?? []) {
      const k = normalizeKind(label?.name ?? undefined);
      if (k) return k;
    }
    return undefined;
  }
}

/**
 * Normalize a free-form type/label name to one of our kinds. Case-insensitive,
 * trims whitespace, accepts both "Epic" and "epic", "spec" and "Specs", etc.
 */
export function normalizeKind(
  raw: string | null | undefined,
): Kind | undefined {
  if (!raw) return undefined;
  const n = raw.trim().toLowerCase().replace(/s$/, "");
  if (n === "epic" || n === "story" || n === "spec" || n === "task") return n;
  return undefined;
}

/**
 * The label we apply when operating in `labels` mode — singular, lowercase,
 * matches the convention in §Appendix C.
 */
export function labelFor(kind: Kind): string {
  return kind;
}

/**
 * Recognize the legacy tasklist syntax in an issue body — `- [ ] #34` or
 * `- [x] org/repo#34` — as a fallback when neither sub-issues API nor labels
 * are available. Returns the issue numbers referenced, in order, deduped.
 */
export function parseTasklistChildren(
  body: string | null | undefined,
): number[] {
  if (!body) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  // `- [ ] #123` or `- [x] owner/repo#123` (we ignore the cross-repo part —
  // chunk 3 only walks the configured repo, by design).
  const re = /^\s*[-*]\s*\[[ xX]\]\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const n = Number(match[1]);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
