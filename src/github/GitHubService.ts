/**
 * GitHubService — the single GitHub client used by every panel, the MCP
 * server, and the methodology bridges in later chunks. Wraps `@octokit/rest`
 * (REST) and `@octokit/graphql` (GraphQL) behind a small typed surface and
 * centralizes three cross-cutting concerns:
 *
 *   1. Auth — token resolution delegated to `AuthService`; the client is
 *      reinstantiated lazily so a `clear()` / `invalidate()` upstream is
 *      reflected without a process restart.
 *   2. Kind classification — `IssueClassifier` decides whether to filter by
 *      Issue Type (preferred) or by label (fallback) per repo.
 *   3. Sub-issue resolution — we try GitHub's native sub-issues API via
 *      GraphQL first, then fall back to tasklist parsing in the issue body
 *      for legacy repos.
 *
 * Pagination is handled per-call: REST lists use `paginate()`, GraphQL lists
 * loop on `pageInfo.hasNextPage`. We don't aggressively cache results here —
 * higher layers (`ThinkubeStore`, panels) own their freshness model.
 *
 * Scope discipline for chunk 3: this file exposes everything the spec lists
 * (read + write across Epic/Story/Spec/Task + Projects v2 Status) plus the
 * helpers `dumpRoadmap` will call. It does NOT yet implement rate-limit
 * telemetry surfacing — we log to console and rethrow on hard limits;
 * status-bar wiring comes in chunk 6 when there's UI to attach it to.
 */
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

import { AuthService } from "./AuthService";
import {
  ClassifierMode,
  IssueClassifier,
  Kind,
  KINDS,
  normalizeKind,
  parseTasklistChildren,
} from "./issueTypes";

export interface RepoCoords {
  owner: string;
  name: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  url: string;
  labels: string[];
  /** Resolved kind, if classifiable. */
  kind?: Kind;
  /** GraphQL node id — needed for sub-issue / projects mutations. */
  nodeId: string;
  /** Native issue type name (only present when repo has Issue Types). */
  issueTypeName?: string;
  /** Total comment count on the issue — needed by chunk-11 quality gates. */
  comments?: number;
}

export interface ProjectInfo {
  id: string;
  number: number;
  title: string;
  url: string;
  ownerLogin: string;
  /** Resolved `Status` single-select field, if present. */
  statusField?: StatusField;
  /** First DATE field (e.g. "Due"), if the board has one. */
  dateField?: { id: string; name: string };
}

export interface StatusField {
  id: string;
  name: string;
  options: Array<{ id: string; name: string }>;
}

export interface ProjectItem {
  id: string;
  issue?: {
    number: number;
    nodeId: string;
    title: string;
    body: string;
    url: string;
    updatedAt?: string;
    /** Sub-issue parent number (the Task's Spec), for grouping/colour. */
    parentNumber?: number;
    /** Parent Spec's last-update time, for staleness ("spec changed after task"). */
    parentUpdatedAt?: string;
  };
  /** Current value of the Status field for this item (name, not id). */
  status?: string;
  /** Value of the board's DATE field for this item (ISO date), if set. */
  dueDate?: string;
  /** Current value of the "Priority" single-select (P0–P3), if set. */
  priority?: string;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  milestone?: number;
  /** Issue Type name (e.g. "Epic"). Only used when the repo has Issue Types. */
  type?: Kind;
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  labels?: string[];
  milestone?: number | null;
  state?: "open" | "closed";
}

interface RawIssueNode {
  number: number;
  title: string;
  body: string | null;
  state: "OPEN" | "CLOSED";
  url: string;
  id: string;
  labels: { nodes: Array<{ name: string }> | null } | null;
  issueType?: { name: string | null } | null;
  comments?: { totalCount: number } | null;
}

const ISSUE_FIELDS = /* GraphQL */ `
  fragment IssueFields on Issue {
    number
    title
    body
    state
    url
    id
    labels(first: 50) {
      nodes {
        name
      }
    }
    issueType {
      name
    }
    comments {
      totalCount
    }
  }
`;

export interface IssueTypeSummary {
  id: number;
  nodeId: string;
  name: string;
  description?: string;
  color?: string;
  isEnabled: boolean;
}

interface RawIssueType {
  id: number;
  node_id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  is_enabled?: boolean;
}

export class GitHubService {
  private readonly classifier: IssueClassifier;
  private restClient: Octokit | undefined;
  private graphqlClient: typeof graphql | undefined;
  private currentToken: string | undefined;

  constructor(private readonly auth: AuthService) {
    // The classifier needs a stable graphql caller, but the underlying
    // client is rebuilt on token changes — capture by reference.
    this.classifier = new IssueClassifier((q, v) => this.runGraphQL(q, v));
  }

  /** Drop cached clients + classifier modes; next call reauths. */
  invalidate(): void {
    this.restClient = undefined;
    this.graphqlClient = undefined;
    this.currentToken = undefined;
    this.classifier.invalidate();
    this.auth.invalidate();
  }

  // ─── Repo + classifier ──────────────────────────────────────────────────

  async getRepo(
    coords: RepoCoords,
  ): Promise<{ id: string; defaultBranch: string }> {
    const data = await this.runGraphQL<{
      repository: {
        id: string;
        defaultBranchRef: { name: string } | null;
      } | null;
    }>(
      /* GraphQL */ `
        query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            id
            defaultBranchRef {
              name
            }
          }
        }
      `,
      coords,
    );
    if (!data.repository) {
      throw new Error(`Repository not found: ${coords.owner}/${coords.name}`);
    }
    return {
      id: data.repository.id,
      defaultBranch: data.repository.defaultBranchRef?.name ?? "main",
    };
  }

  async getClassifierMode(coords: RepoCoords): Promise<ClassifierMode> {
    return (await this.classifier.modeFor(coords.owner, coords.name)).mode;
  }

  // ─── Issues: read ───────────────────────────────────────────────────────

  /**
   * List issues for a repo, optionally filtered by kind and/or by parent
   * (sub-issues of a given issue number). Returns at most `limit` issues —
   * default 250 should cover anything reasonable for a single panel.
   */
  async listIssues(
    coords: RepoCoords,
    opts: {
      type?: Kind;
      parent?: number;
      state?: "open" | "closed" | "all";
      limit?: number;
    } = {},
  ): Promise<IssueSummary[]> {
    const limit = opts.limit ?? 250;

    if (opts.parent !== undefined) {
      const children = await this.listSubIssues(coords, opts.parent, { limit });
      if (opts.type) {
        return children.filter((c) => c.kind === opts.type);
      }
      return children;
    }

    const info = await this.classifier.modeFor(coords.owner, coords.name);
    const stateFilter = opts.state ?? "open";

    // Filter by Issue Type. GitHub's `IssueFilters` input has no issue-type
    // field, so the `issues` connection can't be filtered by type server-side
    // — paginate and match each issue's assigned type client-side.
    if (opts.type) {
      return this.listIssuesByType(coords, opts.type, stateFilter, limit);
    }

    // "List all": REST listForRepo. Kind is resolved from each issue's
    // assigned Issue Type (`issue.type`), not from labels.
    return this.listIssuesByLabel(
      coords,
      undefined,
      stateFilter,
      limit,
      info.mode,
    );
  }

  async getIssue(coords: RepoCoords, number: number): Promise<IssueSummary> {
    const data = await this.runGraphQL<{
      repository: { issue: RawIssueNode | null } | null;
    }>(
      /* GraphQL */ `
        ${ISSUE_FIELDS}
        query ($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            issue(number: $number) {
              ...IssueFields
            }
          }
        }
      `,
      { ...coords, number },
    );
    const node = data.repository?.issue;
    if (!node) {
      throw new Error(
        `Issue not found: ${coords.owner}/${coords.name}#${number}`,
      );
    }
    const info = await this.classifier.modeFor(coords.owner, coords.name);
    return this.toSummary(node, info.mode);
  }

  /**
   * Resolve children of an issue. Tries the native sub-issues API via
   * GraphQL first; on miss or empty result, falls back to parsing the
   * tasklist syntax from the parent's body.
   */
  /**
   * Walk one step up the sub-issue parent chain for a given issue. Returns
   * `undefined` if the issue has no parent or if the host doesn't expose
   * `Issue.parent` in its schema (older GHE deployments). Used by the
   * chunk-11 Review→Verify gate to resolve a Task's parent Spec.
   */
  async getParentIssue(
    coords: RepoCoords,
    number: number,
  ): Promise<IssueSummary | undefined> {
    try {
      const data = await this.runGraphQL<{
        repository: {
          issue: {
            parent: RawIssueNode | null;
          } | null;
        } | null;
      }>(
        /* GraphQL */ `
          ${ISSUE_FIELDS}
          query ($owner: String!, $name: String!, $number: Int!) {
            repository(owner: $owner, name: $name) {
              issue(number: $number) {
                parent {
                  ...IssueFields
                }
              }
            }
          }
        `,
        { ...coords, number },
      );
      const node = data.repository?.issue?.parent;
      if (!node) return undefined;
      const info = await this.classifier.modeFor(coords.owner, coords.name);
      return this.toSummary(node, info.mode);
    } catch {
      // Host doesn't expose `Issue.parent` — caller can fall back to a
      // tasklist parse if it has the broader-issue context.
      return undefined;
    }
  }

  async listSubIssues(
    coords: RepoCoords,
    parent: number,
    opts: { limit?: number } = {},
  ): Promise<IssueSummary[]> {
    const limit = opts.limit ?? 250;
    const info = await this.classifier.modeFor(coords.owner, coords.name);

    const native = await this.tryNativeSubIssues(
      coords,
      parent,
      limit,
      info.mode,
    );
    if (native !== undefined) return native;

    // Fallback: parse the parent body's tasklist and hydrate each ref.
    const parentIssue = await this.getIssue(coords, parent);
    const numbers = parseTasklistChildren(parentIssue.body).slice(0, limit);
    const children: IssueSummary[] = [];
    for (const n of numbers) {
      try {
        children.push(await this.getIssue(coords, n));
      } catch {
        // Cross-repo refs and deleted issues are expected — skip silently.
      }
    }
    return children;
  }

  private async tryNativeSubIssues(
    coords: RepoCoords,
    parent: number,
    limit: number,
    mode: ClassifierMode,
  ): Promise<IssueSummary[] | undefined> {
    try {
      const data = await this.runGraphQL<{
        repository: {
          issue: {
            subIssues: {
              nodes: RawIssueNode[];
              pageInfo: { endCursor: string | null; hasNextPage: boolean };
            } | null;
          } | null;
        } | null;
      }>(
        /* GraphQL */ `
          ${ISSUE_FIELDS}
          query (
            $owner: String!
            $name: String!
            $number: Int!
            $first: Int!
            $after: String
          ) {
            repository(owner: $owner, name: $name) {
              issue(number: $number) {
                subIssues(first: $first, after: $after) {
                  nodes {
                    ...IssueFields
                  }
                  pageInfo {
                    endCursor
                    hasNextPage
                  }
                }
              }
            }
          }
        `,
        { ...coords, number: parent, first: Math.min(limit, 100), after: null },
      );
      const block = data.repository?.issue?.subIssues;
      if (!block) return undefined;

      const out: IssueSummary[] = block.nodes.map((n) =>
        this.toSummary(n, mode),
      );

      // Continue paging until we hit limit or run out.
      let cursor = block.pageInfo.endCursor;
      let hasNext = block.pageInfo.hasNextPage;
      while (hasNext && out.length < limit) {
        const more = await this.runGraphQL<{
          repository: {
            issue: {
              subIssues: {
                nodes: RawIssueNode[];
                pageInfo: { endCursor: string | null; hasNextPage: boolean };
              };
            };
          };
        }>(
          /* GraphQL */ `
            ${ISSUE_FIELDS}
            query (
              $owner: String!
              $name: String!
              $number: Int!
              $first: Int!
              $after: String
            ) {
              repository(owner: $owner, name: $name) {
                issue(number: $number) {
                  subIssues(first: $first, after: $after) {
                    nodes {
                      ...IssueFields
                    }
                    pageInfo {
                      endCursor
                      hasNextPage
                    }
                  }
                }
              }
            }
          `,
          {
            ...coords,
            number: parent,
            first: Math.min(limit - out.length, 100),
            after: cursor,
          },
        );
        for (const n of more.repository.issue.subIssues.nodes) {
          out.push(this.toSummary(n, mode));
        }
        cursor = more.repository.issue.subIssues.pageInfo.endCursor;
        hasNext = more.repository.issue.subIssues.pageInfo.hasNextPage;
      }
      return out;
    } catch (err) {
      // Field unavailable on this schema (older Enterprise, etc.) or
      // permission error — fall through to tasklist fallback.
      return undefined;
    }
  }

  private async listIssuesByType(
    coords: RepoCoords,
    kind: Kind,
    state: "open" | "closed" | "all",
    limit: number,
  ): Promise<IssueSummary[]> {
    const out: IssueSummary[] = [];
    let cursor: string | null = null;
    const stateArg = state === "all" ? null : state.toUpperCase();
    type IssuesPage = {
      repository: {
        issues: {
          nodes: RawIssueNode[];
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
        };
      };
    };
    // GitHub's `IssueFilters` input has no issue-type field, so the `issues`
    // connection can't be filtered by type server-side. Paginate every issue
    // and keep the ones whose assigned type maps to `kind`.
    while (out.length < limit) {
      const data: IssuesPage = await this.runGraphQL<IssuesPage>(
        /* GraphQL */ `
          ${ISSUE_FIELDS}
          query (
            $owner: String!
            $name: String!
            $first: Int!
            $after: String
            $states: [IssueState!]
          ) {
            repository(owner: $owner, name: $name) {
              issues(
                first: $first
                after: $after
                states: $states
                orderBy: { field: CREATED_AT, direction: DESC }
              ) {
                nodes {
                  ...IssueFields
                }
                pageInfo {
                  endCursor
                  hasNextPage
                }
              }
            }
          }
        `,
        {
          ...coords,
          first: 100,
          after: cursor,
          states: stateArg ? [stateArg] : null,
        },
      );
      for (const n of data.repository.issues.nodes) {
        const summary = this.toSummary(n, "issue-types");
        if (summary.kind === kind) out.push(summary);
        if (out.length >= limit) break;
      }
      if (!data.repository.issues.pageInfo.hasNextPage) break;
      cursor = data.repository.issues.pageInfo.endCursor;
    }
    return out;
  }

  private async listIssuesByLabel(
    coords: RepoCoords,
    label: string | undefined,
    state: "open" | "closed" | "all",
    limit: number,
    mode: ClassifierMode,
  ): Promise<IssueSummary[]> {
    const rest = await this.rest();
    const out: IssueSummary[] = [];
    let page = 1;
    const perPage = 100;
    while (out.length < limit) {
      const resp = await rest.rest.issues.listForRepo({
        owner: coords.owner,
        repo: coords.name,
        state,
        labels: label,
        per_page: perPage,
        page,
      });
      // Octokit-v19 endpoint method types tag `labels` as either a string or
      // a label object — `as any[]` here keeps the call site readable; runtime
      // handles both shapes via the typeof guard.
      const issues = resp.data as Array<{
        number: number;
        title: string | null;
        body: string | null;
        state: string;
        html_url: string;
        node_id: string;
        type?: { name?: string | null } | null;
        labels?: Array<string | { name?: string | null }>;
        pull_request?: unknown;
      }>;
      for (const issue of issues) {
        // listForRepo returns PRs too; drop them.
        if (issue.pull_request) continue;
        const labelNames = (issue.labels ?? [])
          .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
          .filter(Boolean);
        out.push({
          number: issue.number,
          title: issue.title ?? "",
          body: issue.body ?? null,
          state: (issue.state as "open" | "closed") ?? "open",
          url: issue.html_url,
          nodeId: issue.node_id,
          labels: labelNames,
          kind: this.classifier.classify({
            number: issue.number,
            body: issue.body ?? null,
            issueType: issue.type ?? null,
            labels: (issue.labels ?? []).map((l) => ({
              name: typeof l === "string" ? l : (l.name ?? null),
            })),
          }),
        });
        if (out.length >= limit) return out;
      }
      if (issues.length < perPage) break;
      page += 1;
    }
    return out;
  }

  // ─── Issues: write ──────────────────────────────────────────────────────

  async createIssue(
    coords: RepoCoords,
    input: CreateIssueInput,
  ): Promise<IssueSummary> {
    const info = await this.classifier.modeFor(coords.owner, coords.name);
    const labels = [...(input.labels ?? [])];
    let issueTypeId: string | undefined;

    // Always assign the native Issue Type — never a kind label. (`modeFor`
    // throws above if the repo lacks the four types, so typeIds is complete.)
    if (input.type) {
      issueTypeId = info.typeIds[input.type];
    }

    const rest = await this.rest();
    const created = await rest.rest.issues.create({
      owner: coords.owner,
      repo: coords.name,
      title: input.title,
      body: input.body,
      labels: labels.length ? labels : undefined,
      milestone: input.milestone,
    });

    // Set Issue Type via GraphQL mutation if we have one (REST doesn't
    // expose `type` on issues.create yet across all repo states).
    if (issueTypeId) {
      try {
        await this.runGraphQL(
          /* GraphQL */ `
            mutation ($issueId: ID!, $typeId: ID!) {
              updateIssueIssueType(
                input: { issueId: $issueId, issueTypeId: $typeId }
              ) {
                issue {
                  id
                }
              }
            }
          `,
          { issueId: created.data.node_id, typeId: issueTypeId },
        );
      } catch {
        // Mutation not yet available on this host — leave the labels
        // we already applied as the discriminator.
      }
    }

    return this.getIssue(coords, created.data.number);
  }

  async updateIssue(
    coords: RepoCoords,
    number: number,
    input: UpdateIssueInput,
  ): Promise<IssueSummary> {
    const rest = await this.rest();
    await rest.rest.issues.update({
      owner: coords.owner,
      repo: coords.name,
      issue_number: number,
      title: input.title,
      body: input.body,
      labels: input.labels,
      // Octokit's type wants number | undefined; we accept null upstream as
      // "clear the milestone" but the REST surface uses undefined for that.
      milestone: input.milestone ?? undefined,
      state: input.state,
    });
    return this.getIssue(coords, number);
  }

  async addComment(
    coords: RepoCoords,
    number: number,
    body: string,
  ): Promise<void> {
    const rest = await this.rest();
    await rest.rest.issues.createComment({
      owner: coords.owner,
      repo: coords.name,
      issue_number: number,
      body,
    });
  }

  async closeIssue(
    coords: RepoCoords,
    number: number,
    reason?: "completed" | "not_planned",
  ): Promise<void> {
    const rest = await this.rest();
    await rest.rest.issues.update({
      owner: coords.owner,
      repo: coords.name,
      issue_number: number,
      state: "closed",
      state_reason: reason,
    });
  }

  /**
   * Link an existing child issue under a parent via the native sub-issues
   * API. Both ids must be GraphQL node ids (the `nodeId` field on
   * IssueSummary). On hosts where the mutation isn't available, we leave
   * the link unset — callers can fall back to a tasklist edit if needed.
   */
  async addSubIssue(parentNodeId: string, childNodeId: string): Promise<void> {
    await this.runGraphQL(
      /* GraphQL */ `
        mutation ($issueId: ID!, $subIssueId: ID!) {
          addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
            issue {
              id
            }
          }
        }
      `,
      { issueId: parentNodeId, subIssueId: childNodeId },
    );
  }

  // ─── Issue Types (org-level) ────────────────────────────────────────────

  /**
   * Whether the authenticated user can manage org-level Issue Types — i.e. is
   * an organization owner. Issue Types are org-scoped; creating/updating them
   * requires `admin:org` (classic) or the org-admin fine-grained permission.
   * Read-only probe — returns false on any access error rather than throwing,
   * so callers can fail fast cleanly.
   */
  async canManageOrgIssueTypes(org: string): Promise<boolean> {
    const rest = await this.rest();
    try {
      const res = await rest.request("GET /user/memberships/orgs/{org}", {
        org,
      });
      return (res.data as { role?: string }).role === "admin";
    } catch {
      return false;
    }
  }

  /** List the org's Issue Types. */
  async listIssueTypes(org: string): Promise<IssueTypeSummary[]> {
    const rest = await this.rest();
    const res = await rest.request("GET /orgs/{org}/issue-types", { org });
    return (res.data as RawIssueType[]).map((d) => this.mapIssueType(d));
  }

  /**
   * Create an org-level Issue Type. Requires `admin:org` (org owner). Callers
   * should gate with `canManageOrgIssueTypes` first to fail fast; this also
   * rethrows a clear, actionable error if the API returns 403.
   */
  async createIssueType(
    org: string,
    input: { name: string; description?: string; color?: string },
  ): Promise<IssueTypeSummary> {
    const rest = await this.rest();
    try {
      const res = await rest.request("POST /orgs/{org}/issue-types", {
        org,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        is_enabled: true,
      });
      return this.mapIssueType(res.data as RawIssueType);
    } catch (err) {
      if ((err as { status?: number }).status === 403) {
        throw new Error(
          `Insufficient permission to create the "${input.name}" Issue Type in org "${org}". ` +
            "Creating Issue Types requires the `admin:org` permission (organization owner). " +
            "Add the scope to your token and retry.",
        );
      }
      throw err;
    }
  }

  private mapIssueType(d: RawIssueType): IssueTypeSummary {
    return {
      id: d.id,
      nodeId: d.node_id,
      name: d.name,
      description: d.description ?? undefined,
      color: d.color ?? undefined,
      isEnabled: d.is_enabled ?? true,
    };
  }

  // ─── Projects v2 ────────────────────────────────────────────────────────

  async getProject(
    ownerLogin: string,
    projectNumber: number,
  ): Promise<ProjectInfo> {
    // `repositoryOwner` + an inline fragment on the `ProjectV2Owner` interface
    // resolves for both Users and Organizations in one query. Querying
    // `organization(login:)` and `user(login:)` separately makes GitHub return
    // a hard error for whichever type the login *isn't*, which @octokit/graphql
    // throws on even when the other branch resolved.
    const data = await this.runGraphQL<{
      repositoryOwner: ProjectQueryResult | null;
    }>(
      /* GraphQL */ `
        query ($login: String!, $number: Int!) {
          repositoryOwner(login: $login) {
            ... on ProjectV2Owner {
              projectV2(number: $number) {
                id
                number
                title
                url
                fields(first: 50) {
                  nodes {
                    ... on ProjectV2SingleSelectField {
                      id
                      name
                      options {
                        id
                        name
                      }
                    }
                    ... on ProjectV2Field {
                      id
                      name
                      dataType
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { login: ownerLogin, number: projectNumber },
    );

    const node = data.repositoryOwner?.projectV2;
    if (!node) {
      throw new Error(
        `Project not found: ${ownerLogin}/projects/${projectNumber}`,
      );
    }
    return {
      id: node.id,
      number: node.number,
      title: node.title,
      url: node.url,
      ownerLogin,
      statusField: findStatusField(node),
      dateField: findDateField(node),
    };
  }

  /**
   * List the Projects v2 boards owned by `ownerLogin` (user or org), each with
   * its resolved Status field. Used to auto-discover the methodology board so
   * the user doesn't have to look up a project number by hand.
   */
  async listProjects(ownerLogin: string): Promise<ProjectInfo[]> {
    const projectFields = /* GraphQL */ `
      nodes {
        id
        number
        title
        url
        fields(first: 50) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    `;
    const data = await this.runGraphQL<{
      repositoryOwner: {
        projectsV2: { nodes: Array<ProjectNode | null> };
      } | null;
    }>(
      /* GraphQL */ `
        query ($login: String!) {
          repositoryOwner(login: $login) {
            ... on ProjectV2Owner {
              projectsV2(first: 50) { ${projectFields} }
            }
          }
        }
      `,
      { login: ownerLogin },
    );

    const nodes = data.repositoryOwner?.projectsV2?.nodes ?? [];
    return nodes
      .filter((n): n is ProjectNode => Boolean(n))
      .map((n) => ({
        id: n.id,
        number: n.number,
        title: n.title,
        url: n.url,
        ownerLogin,
        statusField: findStatusField(n),
      }));
  }

  async getStatusField(projectId: string): Promise<StatusField | undefined> {
    const data = await this.runGraphQL<{
      node: {
        fields: {
          nodes: Array<{
            id?: string;
            name?: string;
            options?: Array<{ id: string; name: string }>;
          }>;
        };
      } | null;
    }>(
      /* GraphQL */ `
        query ($id: ID!) {
          node(id: $id) {
            ... on ProjectV2 {
              fields(first: 50) {
                nodes {
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { id: projectId },
    );
    return findStatusField(data.node ?? undefined);
  }

  /** Find a single-select field by name on a project (e.g. "Priority"). */
  async getSingleSelectFieldByName(
    projectId: string,
    name: string,
  ): Promise<
    { id: string; name: string; options: { id: string; name: string }[] } | undefined
  > {
    const data = await this.runGraphQL<{
      node: {
        fields: {
          nodes: Array<{
            id?: string;
            name?: string;
            options?: Array<{ id: string; name: string }>;
          }>;
        };
      } | null;
    }>(
      /* GraphQL */ `
        query ($id: ID!) {
          node(id: $id) {
            ... on ProjectV2 {
              fields(first: 50) {
                nodes {
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { id: projectId },
    );
    for (const f of data.node?.fields?.nodes ?? []) {
      if (f?.id && f.name === name && Array.isArray(f.options)) {
        return { id: f.id, name: f.name, options: f.options };
      }
    }
    return undefined;
  }

  /**
   * Bring the configured org + board up to the methodology schema: the four
   * Issue Types (Epic/Story/Spec/Task) and a single-select Priority field
   * (P0–P3). Fails fast — before mutating anything — when the token can't
   * manage org Issue Types. Idempotent: only creates what's missing.
   */
  async enforceSchema(
    coords: RepoCoords,
    projectId: string,
  ): Promise<{
    issueTypesCreated: string[];
    priorityField: { fieldId: string; created: boolean; optionsAdded: string[] };
  }> {
    const org = coords.owner;

    // Fail fast before any change.
    if (!(await this.canManageOrgIssueTypes(org))) {
      throw new Error(
        `Cannot enforce the methodology schema in "${org}": the authenticated user is not an ` +
          "organization owner (creating org Issue Types requires the `admin:org` permission). " +
          "Re-run configure with an org-owner token that has `admin:org`.",
      );
    }

    // 1. Issue Types — create any of the four kinds that are missing.
    const KIND_TYPES: ReadonlyArray<{
      name: string;
      description: string;
      color: string;
    }> = [
      { name: "Epic", description: "A multi-week initiative", color: "purple" },
      { name: "Story", description: "A user-observable deliverable", color: "blue" },
      { name: "Spec", description: "The technical how for one Story slice", color: "green" },
      { name: "Task", description: "1–3 hours of focused work", color: "gray" },
    ];
    const existing = new Set(
      (await this.listIssueTypes(org)).map((t) => t.name.toLowerCase()),
    );
    const issueTypesCreated: string[] = [];
    for (const t of KIND_TYPES) {
      if (existing.has(t.name.toLowerCase())) continue;
      await this.createIssueType(org, {
        name: t.name,
        description: t.description,
        color: t.color,
      });
      issueTypesCreated.push(t.name);
    }
    // New types change the classifier mode → drop the cached probe.
    this.classifier.invalidate(org, coords.name);

    // 2. Priority field (single-select P0–P3).
    const PRIORITY_OPTIONS = [
      { name: "P0", color: "RED", description: "Critical" },
      { name: "P1", color: "ORANGE", description: "High" },
      { name: "P2", color: "YELLOW", description: "Normal" },
      { name: "P3", color: "GRAY", description: "Low" },
    ];
    const field = await this.getSingleSelectFieldByName(projectId, "Priority");
    let priorityField: {
      fieldId: string;
      created: boolean;
      optionsAdded: string[];
    };
    if (!field) {
      const made = await this.createSingleSelectField(
        projectId,
        "Priority",
        PRIORITY_OPTIONS,
      );
      priorityField = {
        fieldId: made.fieldId,
        created: true,
        optionsAdded: PRIORITY_OPTIONS.map((o) => o.name),
      };
    } else {
      const added = await this.ensureSingleSelectOptions(
        field.id,
        PRIORITY_OPTIONS,
      );
      priorityField = { fieldId: field.id, created: false, optionsAdded: added };
    }

    return { issueTypesCreated, priorityField };
  }

  // ─── Schema migration ───────────────────────────────────────────────────

  /** Assign an existing Issue Type (by node id) to an issue. */
  private async assignIssueType(
    issueNodeId: string,
    typeNodeId: string,
  ): Promise<void> {
    await this.runGraphQL(
      /* GraphQL */ `
        mutation ($issueId: ID!, $typeId: ID!) {
          updateIssueIssueType(
            input: { issueId: $issueId, issueTypeId: $typeId }
          ) {
            issue {
              id
            }
          }
        }
      `,
      { issueId: issueNodeId, typeId: typeNodeId },
    );
  }

  /** Remove a label from an issue; a 404 (label absent) is treated as success. */
  private async removeLabel(
    coords: RepoCoords,
    issueNumber: number,
    name: string,
  ): Promise<void> {
    const rest = await this.rest();
    try {
      await rest.rest.issues.removeLabel({
        owner: coords.owner,
        repo: coords.name,
        issue_number: issueNumber,
        name,
      });
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }

  /**
   * Migrate label-based methodology issues to native Issue Types: for every
   * issue carrying an `epic`/`story`/`spec`/`task` label, assign the matching
   * Issue Type and strip the now-redundant kind label. Idempotent — re-running
   * only touches issues that still carry a kind label. Requires the four Issue
   * Types to already exist (run `enforceSchema` first).
   */
  async migrateLabelKindsToTypes(
    coords: RepoCoords,
  ): Promise<{ migrated: number; perKind: Record<string, number> }> {
    const typeIdByKind = new Map<Kind, string>();
    for (const t of await this.listIssueTypes(coords.owner)) {
      const k = normalizeKind(t.name);
      if (k) typeIdByKind.set(k, t.nodeId);
    }

    const all = await this.listIssues(coords, { state: "all", limit: 1000 });
    const perKind: Record<string, number> = {};
    let migrated = 0;
    for (const issue of all) {
      const kind = issue.labels
        .map((l) => normalizeKind(l))
        .find((k): k is Kind => !!k);
      if (!kind) continue;
      const typeId = typeIdByKind.get(kind);
      if (!typeId) continue;

      if (normalizeKind(issue.issueTypeName) !== kind) {
        await this.assignIssueType(issue.nodeId, typeId);
      }
      await this.removeLabel(coords, issue.number, kind);
      perKind[kind] = (perKind[kind] ?? 0) + 1;
      migrated += 1;
    }
    this.classifier.invalidate(coords.owner, coords.name);
    return { migrated, perKind };
  }

  async listProjectItems(
    projectId: string,
    limit = 500,
  ): Promise<ProjectItem[]> {
    const out: ProjectItem[] = [];
    let cursor: string | null = null;
    type FieldValueNode = {
      __typename?: string;
      name?: string;
      date?: string;
      field?: { __typename?: string; name?: string } | null;
    } | null;
    type ProjectItemsPage = {
      node: {
        items: {
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
          nodes: Array<{
            id: string;
            content?: {
              __typename?: string;
              number?: number;
              id?: string;
              title?: string;
              body?: string;
              url?: string;
              updatedAt?: string;
              parent?: { number?: number; updatedAt?: string } | null;
            } | null;
            fieldValues: { nodes: FieldValueNode[] };
          }>;
        };
      } | null;
    };
    while (out.length < limit) {
      const data: ProjectItemsPage = await this.runGraphQL<ProjectItemsPage>(
        /* GraphQL */ `
          query ($id: ID!, $first: Int!, $after: String) {
            node(id: $id) {
              ... on ProjectV2 {
                items(first: $first, after: $after) {
                  pageInfo {
                    endCursor
                    hasNextPage
                  }
                  nodes {
                    id
                    content {
                      __typename
                      ... on Issue {
                        number
                        id
                        title
                        body
                        url
                        updatedAt
                        parent {
                          number
                          updatedAt
                        }
                      }
                    }
                    fieldValues(first: 20) {
                      nodes {
                        __typename
                        ... on ProjectV2ItemFieldSingleSelectValue {
                          name
                          field {
                            ... on ProjectV2SingleSelectField {
                              name
                            }
                          }
                        }
                        ... on ProjectV2ItemFieldDateValue {
                          date
                          field {
                            ... on ProjectV2FieldCommon {
                              name
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          id: projectId,
          first: Math.min(limit - out.length, 100),
          after: cursor,
        },
      );
      const items = data.node?.items;
      if (!items) break;
      for (const it of items.nodes) {
        const issueContent =
          it.content && it.content.__typename === "Issue"
            ? it.content
            : undefined;
        const values = it.fieldValues?.nodes ?? [];
        const statusValue = values.find(
          (v: FieldValueNode) =>
            !!v &&
            v.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
            v.field?.name === "Status",
        );
        const dateValue = values.find(
          (v: FieldValueNode) =>
            !!v && v.__typename === "ProjectV2ItemFieldDateValue" && !!v.date,
        );
        const priorityValue = values.find(
          (v: FieldValueNode) =>
            !!v &&
            v.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
            v.field?.name === "Priority",
        );
        out.push({
          id: it.id,
          issue: issueContent
            ? {
                number: issueContent.number!,
                nodeId: issueContent.id!,
                title: issueContent.title ?? "",
                body: issueContent.body ?? "",
                url: issueContent.url ?? "",
                updatedAt: issueContent.updatedAt,
                parentNumber: issueContent.parent?.number,
                parentUpdatedAt: issueContent.parent?.updatedAt,
              }
            : undefined,
          status: statusValue?.name,
          dueDate: dateValue?.date,
          priority: priorityValue?.name,
        });
        if (out.length >= limit) break;
      }
      if (!items.pageInfo.hasNextPage) break;
      cursor = items.pageInfo.endCursor;
    }
    return out;
  }

  /**
   * Attach an existing issue (or PR) to a Projects v2 board as an item.
   * Returns the new item id so callers can immediately call `setStatus`
   * to drop it into the right column.
   *
   * `contentNodeId` is the GraphQL node id of the issue (the `nodeId`
   * field on IssueSummary). If the content is already on the project,
   * GitHub returns the existing item id rather than erroring — so calls
   * here are effectively idempotent.
   */
  async addItemToProject(
    projectId: string,
    contentNodeId: string,
  ): Promise<{ itemId: string }> {
    const data = await this.runGraphQL<{
      addProjectV2ItemById: { item: { id: string } | null } | null;
    }>(
      /* GraphQL */ `
        mutation ($project: ID!, $content: ID!) {
          addProjectV2ItemById(
            input: { projectId: $project, contentId: $content }
          ) {
            item {
              id
            }
          }
        }
      `,
      { project: projectId, content: contentNodeId },
    );
    const itemId = data.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      throw new Error(
        `addItemToProject: server returned no item id for content ${contentNodeId}`,
      );
    }
    return { itemId };
  }

  /** Move an item to a different Status option. */
  async setStatus(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void> {
    await this.setSingleSelectValue(projectId, itemId, fieldId, optionId);
  }

  /** Set an item's Priority (or any single-select field) option. */
  async setPriority(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void> {
    await this.setSingleSelectValue(projectId, itemId, fieldId, optionId);
  }

  /** Set a single-select field value on a project item. */
  private async setSingleSelectValue(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void> {
    await this.runGraphQL(
      /* GraphQL */ `
        mutation ($project: ID!, $item: ID!, $field: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $project
              itemId: $item
              fieldId: $field
              value: { singleSelectOptionId: $optionId }
            }
          ) {
            projectV2Item {
              id
            }
          }
        }
      `,
      { project: projectId, item: itemId, field: fieldId, optionId },
    );
  }

  /**
   * Reorder a project item — set its position to just after `afterItemId`
   * (or to the top of the board when `afterItemId` is null). This is the
   * Projects v2 manual order; grouped by Status, items render in this order
   * within each column, so it is the board's priority order.
   */
  async setItemPosition(
    projectId: string,
    itemId: string,
    afterItemId: string | null,
  ): Promise<void> {
    await this.runGraphQL(
      /* GraphQL */ `
        mutation ($project: ID!, $item: ID!, $after: ID) {
          updateProjectV2ItemPosition(
            input: { projectId: $project, itemId: $item, afterId: $after }
          ) {
            clientMutationId
          }
        }
      `,
      { project: projectId, item: itemId, after: afterItemId },
    );
  }

  /** Set (or clear, with `null`) a DATE field value on a project item. */
  async setDateField(
    projectId: string,
    itemId: string,
    fieldId: string,
    date: string | null,
  ): Promise<void> {
    await this.runGraphQL(
      /* GraphQL */ `
        mutation ($project: ID!, $item: ID!, $field: ID!, $date: Date) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $project
              itemId: $item
              fieldId: $field
              value: { date: $date }
            }
          ) {
            projectV2Item {
              id
            }
          }
        }
      `,
      { project: projectId, item: itemId, field: fieldId, date },
    );
  }

  /**
   * Ensure a single-select field (e.g. a board's "Status") contains every
   * option in `desired`, creating any that are missing. Non-destructive:
   * existing options are preserved verbatim (id, name, colour, description) so
   * items keep their values; we only re-order so the desired set leads in the
   * given order, with any extra pre-existing options kept at the end.
   *
   * No mutation is issued when nothing is missing — safe to call on every load.
   * Returns the names that were created (empty array ⇒ no-op). Requires the
   * token's `project` scope; throws on permission errors so callers can fall
   * back to asking the user to add the options by hand.
   */
  /**
   * Create a single-select field on a Projects v2 board with the given
   * options (via the `createProjectV2Field` mutation). Returns the new field
   * id and its option ids keyed by name. Topping up options on an existing
   * field is `ensureSingleSelectOptions`.
   */
  async createSingleSelectField(
    projectId: string,
    name: string,
    options: ReadonlyArray<{
      name: string;
      color?: string;
      description?: string;
    }>,
  ): Promise<{ fieldId: string; optionsByName: Record<string, string> }> {
    const data = await this.runGraphQL<{
      createProjectV2Field: {
        projectV2Field:
          | { id: string; options?: { id: string; name: string }[] }
          | null;
      } | null;
    }>(
      /* GraphQL */ `
        mutation (
          $project: ID!
          $name: String!
          $options: [ProjectV2SingleSelectFieldOptionInput!]
        ) {
          createProjectV2Field(
            input: {
              projectId: $project
              dataType: SINGLE_SELECT
              name: $name
              singleSelectOptions: $options
            }
          ) {
            projectV2Field {
              ... on ProjectV2SingleSelectField {
                id
                options {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      {
        project: projectId,
        name,
        options: options.map((o) => ({
          name: o.name,
          color: o.color ?? "GRAY",
          description: o.description ?? "",
        })),
      },
    );
    const field = data.createProjectV2Field?.projectV2Field;
    if (!field) {
      throw new Error(
        `createSingleSelectField: server returned no field for "${name}"`,
      );
    }
    const optionsByName: Record<string, string> = {};
    for (const o of field.options ?? []) optionsByName[o.name] = o.id;
    return { fieldId: field.id, optionsByName };
  }

  async ensureSingleSelectOptions(
    fieldId: string,
    desired: ReadonlyArray<{
      name: string;
      color?: string;
      description?: string;
    }>,
  ): Promise<string[]> {
    type Opt = { id: string; name: string; color: string; description: string };
    const data = await this.runGraphQL<{
      node: { id: string; options?: Opt[] } | null;
    }>(
      /* GraphQL */ `
        query ($id: ID!) {
          node(id: $id) {
            ... on ProjectV2SingleSelectField {
              id
              options {
                id
                name
                color
                description
              }
            }
          }
        }
      `,
      { id: fieldId },
    );
    const existing = data.node?.options;
    if (!existing) {
      throw new Error(
        `Field ${fieldId} is not a single-select field (cannot add options).`,
      );
    }

    const existingByName = new Map(existing.map((o) => [o.name, o]));
    const missing = desired.filter((d) => !existingByName.has(d.name));
    if (missing.length === 0) return [];

    // `updateProjectV2Field` replaces the whole option set, so we must re-send
    // every option we want to keep. Re-sending existing options *with their id*
    // preserves them (and the items assigned to them); options sent without an
    // id are created. We lead with the desired set in order, then append any
    // extra pre-existing options we don't manage (e.g. a stray "Todo").
    const desiredNames = new Set(desired.map((d) => d.name));
    const options = [
      ...desired.map((d) => {
        const ex = existingByName.get(d.name);
        return ex
          ? {
              id: ex.id,
              name: ex.name,
              color: ex.color,
              description: ex.description ?? "",
            }
          : {
              name: d.name,
              color: d.color ?? "GRAY",
              description: d.description ?? "",
            };
      }),
      ...existing
        .filter((o) => !desiredNames.has(o.name))
        .map((o) => ({
          id: o.id,
          name: o.name,
          color: o.color,
          description: o.description ?? "",
        })),
    ];

    await this.runGraphQL(
      /* GraphQL */ `
        mutation (
          $fieldId: ID!
          $options: [ProjectV2SingleSelectFieldOptionInput!]!
        ) {
          updateProjectV2Field(
            input: { fieldId: $fieldId, singleSelectOptions: $options }
          ) {
            projectV2Field {
              ... on ProjectV2SingleSelectField {
                id
              }
            }
          }
        }
      `,
      { fieldId, options },
    );
    return missing.map((d) => d.name);
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private toSummary(node: RawIssueNode, mode: ClassifierMode): IssueSummary {
    const labels = (node.labels?.nodes ?? []).map((l) => l.name);
    const kind =
      this.classifier.classify(
        {
          number: node.number,
          body: node.body,
          labels: node.labels?.nodes ?? [],
          issueType: node.issueType ?? null,
        },
        mode,
      ) ?? normalizeKind(node.issueType?.name);
    return {
      number: node.number,
      title: node.title,
      body: node.body,
      state: node.state === "CLOSED" ? "closed" : "open",
      url: node.url,
      nodeId: node.id,
      labels,
      kind,
      issueTypeName: node.issueType?.name ?? undefined,
      comments: node.comments?.totalCount,
    };
  }

  private async rest(): Promise<Octokit & { rest: Octokit["rest"] }> {
    await this.ensureClients();
    // Octokit's `rest` namespace is just `this` re-exported; using
    // .rest.<resource> makes call sites read clearly.
    const client = this.restClient!;
    return Object.assign(client, { rest: client.rest });
  }

  private async runGraphQL<T = unknown>(
    query: string,
    variables?: Record<string, unknown> | object,
  ): Promise<T> {
    await this.ensureClients();
    return this.graphqlClient!<T>(
      query,
      variables as Record<string, unknown> | undefined,
    );
  }

  private async ensureClients(): Promise<void> {
    const token = await this.auth.getToken({ prompt: true });
    if (!token) {
      throw new Error(
        "GitHub token unavailable — set GITHUB_TOKEN, run `gh auth login`, or paste a PAT when prompted.",
      );
    }
    if (token !== this.currentToken) {
      this.currentToken = token;
      this.restClient = new Octokit({
        auth: token,
        userAgent: "thinkube-ai-integration",
      });
      this.graphqlClient = graphql.defaults({
        headers: {
          authorization: `token ${token}`,
          "user-agent": "thinkube-ai-integration",
        },
      });
    }
  }
}

interface ProjectQueryResult {
  projectV2: {
    id: string;
    number: number;
    title: string;
    url: string;
    fields: {
      nodes: Array<{
        id?: string;
        name?: string;
        dataType?: string;
        options?: Array<{ id: string; name: string }>;
      }>;
    };
  } | null;
}

/** A single Projects v2 node as returned by getProject / listProjects. */
type ProjectNode = NonNullable<ProjectQueryResult["projectV2"]>;

/** First DATE-typed field on the project (e.g. "Due"), if any. */
function findDateField(
  node: ProjectNode | undefined,
): { id: string; name: string } | undefined {
  const fields = node?.fields?.nodes ?? [];
  for (const f of fields) {
    if (f?.id && f.name && f.dataType === "DATE") {
      return { id: f.id, name: f.name };
    }
  }
  return undefined;
}

function findStatusField(
  node:
    | ProjectQueryResult["projectV2"]
    | {
        fields: ProjectQueryResult["projectV2"] extends infer P
          ? P extends { fields: infer F }
            ? F
            : never
          : never;
      }
    | undefined,
): StatusField | undefined {
  if (!node) return undefined;
  const fields =
    (
      node as {
        fields?: {
          nodes?: Array<{
            id?: string;
            name?: string;
            options?: Array<{ id: string; name: string }>;
          }>;
        };
      }
    ).fields?.nodes ?? [];
  for (const f of fields) {
    if (f?.id && f.name === "Status" && Array.isArray(f.options)) {
      return { id: f.id, name: f.name, options: f.options };
    }
  }
  return undefined;
}

// Re-export classifier types so consumers don't need to import from two paths.
export type { Kind } from "./issueTypes";
export { KINDS } from "./issueTypes";
