/**
 * GitHub REST client. Native fetch. AbortSignal cancellable.
 * Endpoints used:
 *   - GET /repos/{o}/{r}/pulls?state=closed&sort=updated  -> merged PR scan
 *   - GET /repos/{o}/{r}/actions/runs?head_sha={sha}      -> runs for commit
 *   - GET /repos/{o}/{r}/actions/runs/{id}                -> run status poll
 */

const BASE = "https://api.github.com";

export interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { sha: string };
  user: { login: string } | null;
}

export interface WorkflowRun {
  id: number;
  name: string | null;
  head_sha: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  event: string;
  run_attempt: number;
}

export interface RateLimitInfo {
  remaining: number | null;
  resetEpoch: number | null;
}

export class GithubClient {
  private rateLimit: RateLimitInfo = { remaining: null, resetEpoch: null };

  constructor(private token: string) {}

  getRateLimit(): RateLimitInfo {
    return { ...this.rateLimit };
  }

  private async req<T>(path: string, signal: AbortSignal): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "pi-deploy-watch",
      },
      signal,
    });
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining != null) this.rateLimit.remaining = Number(remaining);
    if (reset != null) this.rateLimit.resetEpoch = Number(reset);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub ${res.status} ${path}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async listRecentMergedPrs(
    owner: string,
    repo: string,
    sinceIso: string,
    signal: AbortSignal,
  ): Promise<PullRequest[]> {
    const since = new Date(sinceIso).getTime();
    const prs = await this.req<PullRequest[]>(
      `/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`,
      signal,
    );
    return prs.filter(
      (p) => p.merged_at != null && new Date(p.merged_at).getTime() > since,
    );
  }

  async runsForSha(
    owner: string,
    repo: string,
    sha: string,
    signal: AbortSignal,
  ): Promise<WorkflowRun[]> {
    const resp = await this.req<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=30`,
      signal,
    );
    return resp.workflow_runs;
  }

  async getRun(
    owner: string,
    repo: string,
    runId: number,
    signal: AbortSignal,
  ): Promise<WorkflowRun> {
    return this.req<WorkflowRun>(`/repos/${owner}/${repo}/actions/runs/${runId}`, signal);
  }
}
