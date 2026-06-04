/**
 * GitHubService — the residual GitHub client, demoted to the REST "inbox"
 * subset after the kanban board moved to files-first (Tandem). The board, the
 * MCP server, and the panels now read and write `.thinkube/` slice files via
 * `ThinkubeStore`; GitHub is no longer the source of truth for the board.
 *
 * What remains here is the dormant inbox plumbing: list / read / create /
 * update / comment / close issues over `@octokit/rest`. There is no GraphQL
 * client anymore — the Projects v2 board, native sub-issues, Issue Types, and
 * schema-enforcement surface (all GraphQL) were removed with the files-first
 * cutover.
 *
 *   - Auth — token resolution delegated to `AuthService`; the REST client is
 *     reinstantiated lazily so an upstream `clear()` / `invalidate()` is
 *     reflected without a process restart.
 *   - Kind classification — issues are classified from their assigned native
 *     Issue Type (`issue.type`) via `IssueClassifier.classify`, which needs no
 *     network round-trip.
 */
import { Octokit } from "@octokit/rest";

import { AuthService } from "./AuthService";
import { GraphQLCaller, IssueClassifier, Kind, KINDS } from "./issueTypes";

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
  /** Total comment count on the issue. */
  comments?: number;
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

/**
 * GraphQL is gone from this service, but `IssueClassifier`'s constructor still
 * takes a caller (it only invokes it in `modeFor`, which the REST-only paths
 * below never call). Hand it one that fails loudly if anything ever reaches
 * for the network — a guard rail, not a code path.
 */
const NO_GRAPHQL: GraphQLCaller = async () => {
  throw new Error(
    "GitHubService no longer has a GraphQL client (files-first cutover).",
  );
};

export class GitHubService {
  private readonly classifier: IssueClassifier;
  private restClient: Octokit | undefined;
  private currentToken: string | undefined;

  constructor(private readonly auth: AuthService) {
    this.classifier = new IssueClassifier(NO_GRAPHQL);
  }

  /** Drop cached client + classifier modes; next call reauths. */
  invalidate(): void {
    this.restClient = undefined;
    this.currentToken = undefined;
    this.classifier.invalidate();
    this.auth.invalidate();
  }

  // ─── Issues: read ───────────────────────────────────────────────────────

  /**
   * List issues for a repo, optionally filtered by a single label. Returns at
   * most `limit` issues — default 250 should cover anything reasonable for a
   * single inbox view. Kind is resolved from each issue's assigned Issue Type.
   */
  async listIssues(
    coords: RepoCoords,
    opts: {
      label?: string;
      state?: "open" | "closed" | "all";
      limit?: number;
    } = {},
  ): Promise<IssueSummary[]> {
    const limit = opts.limit ?? 250;
    const stateFilter = opts.state ?? "open";
    return this.listIssuesByLabel(coords, opts.label, stateFilter, limit);
  }

  async getIssue(coords: RepoCoords, number: number): Promise<IssueSummary> {
    const rest = await this.rest();
    const resp = await rest.rest.issues.get({
      owner: coords.owner,
      repo: coords.name,
      issue_number: number,
    });
    return this.toSummary(resp.data);
  }

  private async listIssuesByLabel(
    coords: RepoCoords,
    label: string | undefined,
    state: "open" | "closed" | "all",
    limit: number,
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
      const issues = resp.data as RestIssue[];
      for (const issue of issues) {
        // listForRepo returns PRs too; drop them.
        if (issue.pull_request) continue;
        out.push(this.toSummary(issue));
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
    const rest = await this.rest();
    const created = await rest.rest.issues.create({
      owner: coords.owner,
      repo: coords.name,
      title: input.title,
      body: input.body,
      labels: input.labels?.length ? input.labels : undefined,
      milestone: input.milestone,
    });
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

  // ─── Internals ──────────────────────────────────────────────────────────

  private toSummary(issue: RestIssue): IssueSummary {
    const labelNames = (issue.labels ?? [])
      .map((l) => (typeof l === "string" ? l : (l?.name ?? "")))
      .filter(Boolean);
    return {
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
          name: typeof l === "string" ? l : (l?.name ?? null),
        })),
      }),
      issueTypeName: issue.type?.name ?? undefined,
      comments: issue.comments,
    };
  }

  private async rest(): Promise<Octokit & { rest: Octokit["rest"] }> {
    await this.ensureClients();
    // Octokit's `rest` namespace is just `this` re-exported; using
    // .rest.<resource> makes call sites read clearly.
    const client = this.restClient!;
    return Object.assign(client, { rest: client.rest });
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
    }
  }
}

/** Shape of an issue from `@octokit/rest` listForRepo / get. */
interface RestIssue {
  number: number;
  title: string | null;
  body?: string | null;
  state: string;
  html_url: string;
  node_id: string;
  comments?: number;
  type?: { name?: string | null } | null;
  labels?: Array<string | { name?: string | null } | null>;
  pull_request?: unknown;
}

// Re-export classifier types so consumers don't need to import from two paths.
export type { Kind } from "./issueTypes";
export { KINDS } from "./issueTypes";
