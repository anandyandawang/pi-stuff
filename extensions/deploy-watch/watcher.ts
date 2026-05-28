/**
 * Watcher: poll loop + per-deploy track. In-memory state only.
 *
 * Loop:
 *   tick -> for each repo, list merged PRs since cursor -> dedupe ->
 *   fan out trackDeploy(pr) (fire-and-forget, errors caught).
 *
 * trackDeploy:
 *   1. wait for >=1 workflow run for merge SHA (timeout)
 *   2. poll runs until all completed
 *   3. concurrently run configured pup commands
 *   4. on terminal + soak, send steer + notify
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { DeployWatchConfig } from "./config.ts";
import { GithubClient, type PullRequest, type WorkflowRun } from "./github.ts";
import { runPup, type PupResult } from "./pup.ts";

const STEER_BUDGET = 200_000;
const PUP_OUT_CAP = 50_000;

type TerminalRun = WorkflowRun & { conclusion: NonNullable<WorkflowRun["conclusion"]> };

interface DeployState {
  prKey: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  owner: string;
  repo: string;
  sha: string;
  startedAt: number;
  runs: TerminalRun[];
  pup: PupResult[];
  done: boolean;
}

export interface Watcher {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  status(): string;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

const isAbort = (err: unknown): boolean =>
  !!err && typeof err === "object" && (err as any).name === "AbortError";

export function createWatcher(
  cfg: DeployWatchConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Watcher {
  const gh = new GithubClient(cfg.githubToken);
  const controller = new AbortController();

  const seenPrs = new Set<string>();
  const lastCheckedAt = new Map<string, string>();
  const activeDeploys = new Map<string, DeployState>();
  let paused = false;
  let running = false;
  let intervalHandle: NodeJS.Timeout | null = null;

  const nowIso = () => new Date().toISOString();
  for (const r of cfg.repos) lastCheckedAt.set(r.key, nowIso());

  async function tick(): Promise<void> {
    if (paused || running || controller.signal.aborted) return;
    running = true;
    try {
      const rl = gh.getRateLimit();
      if (rl.remaining != null && rl.remaining < 500) {
        ctx.ui.notify(
          `deploy-watch: GH rate limit low (${rl.remaining}), backing off`,
          "warning",
        );
        return;
      }
      for (const r of cfg.repos) {
        const since = lastCheckedAt.get(r.key) ?? nowIso();
        let prs: PullRequest[];
        try {
          prs = await gh.listRecentMergedPrs(r.owner, r.repo, since, controller.signal);
        } catch (err: any) {
          if (isAbort(err)) return;
          ctx.ui.notify(`deploy-watch: list PRs ${r.key}: ${err.message}`, "warning");
          continue;
        }
        lastCheckedAt.set(r.key, nowIso());
        for (const pr of prs) {
          const key = `${r.key}#${pr.number}`;
          if (seenPrs.has(key)) continue;
          seenPrs.add(key);
          void trackDeploy(r.owner, r.repo, r.key, pr).catch((err) => {
            if (isAbort(err)) return;
            ctx.ui.notify(`deploy-watch: track ${key}: ${err.message}`, "warning");
          });
        }
      }
    } finally {
      running = false;
    }
  }

  async function trackDeploy(
    owner: string,
    repo: string,
    repoKey: string,
    pr: PullRequest,
  ): Promise<void> {
    const sha = pr.merge_commit_sha ?? pr.head.sha;
    const prKey = `${repoKey}#${pr.number}`;
    const state: DeployState = {
      prKey,
      prNumber: pr.number,
      prUrl: pr.html_url,
      prTitle: pr.title,
      owner,
      repo,
      sha,
      startedAt: Date.now(),
      runs: [],
      pup: [],
      done: false,
    };
    activeDeploys.set(prKey, state);
    ctx.ui.notify(`deploy-watch: tracking ${prKey} (${sha.slice(0, 7)})`, "info");

    try {
      const runs = await waitForRuns(owner, repo, sha);
      if (runs.length === 0) {
        ctx.ui.notify(
          `deploy-watch: ${prKey} no workflow runs after ${Math.round(cfg.workflowStartTimeoutMs / 1000)}s`,
          "warning",
        );
        activeDeploys.delete(prKey);
        return;
      }

      const pupPromise = runConfiguredPup();
      const terminal = await Promise.all(
        runs.map((r) => pollRunUntilDone(owner, repo, r.id)),
      );
      state.runs = terminal;
      state.pup = await pupPromise;

      if (cfg.soakMs > 0) {
        try {
          await sleep(cfg.soakMs, controller.signal);
        } catch (err) {
          if (isAbort(err)) return;
          throw err;
        }
      }

      state.done = true;
      emitSummary(state);
    } finally {
      activeDeploys.delete(prKey);
    }
  }

  async function waitForRuns(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<WorkflowRun[]> {
    const deadline = Date.now() + cfg.workflowStartTimeoutMs;
    while (Date.now() < deadline && !controller.signal.aborted) {
      try {
        const runs = await gh.runsForSha(owner, repo, sha, controller.signal);
        if (runs.length > 0) return runs;
      } catch (err) {
        if (isAbort(err)) return [];
      }
      try {
        await sleep(cfg.pollMs, controller.signal);
      } catch (err) {
        if (isAbort(err)) return [];
      }
    }
    return [];
  }

  async function pollRunUntilDone(
    owner: string,
    repo: string,
    runId: number,
  ): Promise<TerminalRun> {
    while (!controller.signal.aborted) {
      let r: WorkflowRun;
      try {
        r = await gh.getRun(owner, repo, runId, controller.signal);
      } catch (err) {
        if (isAbort(err)) throw err;
        await sleep(cfg.runPollMs, controller.signal);
        continue;
      }
      if (r.status === "completed" && r.conclusion != null) {
        return r as TerminalRun;
      }
      await sleep(cfg.runPollMs, controller.signal);
    }
    throw new DOMException("aborted", "AbortError");
  }

  async function runConfiguredPup(): Promise<PupResult[]> {
    if (cfg.pupCommands.length === 0) return [];
    return Promise.all(
      cfg.pupCommands.map((cmd) => runPup(cfg.pupBin, cmd, controller.signal)),
    );
  }

  function emitSummary(state: DeployState): void {
    const conclusions = state.runs.map((r) => r.conclusion);
    const allGreen = conclusions.every((c) => c === "success" || c === "skipped");
    const headline = allGreen
      ? `deploy-watch: ${state.prKey} OK (${conclusions.join(",")})`
      : `deploy-watch: ${state.prKey} NEEDS REVIEW (${conclusions.join(",")})`;
    ctx.ui.notify(headline, allGreen ? "info" : "warning");

    const payload = buildSteerPayload(state);
    void pi.sendUserMessage(payload, { deliverAs: "steer" });
  }

  function buildSteerPayload(state: DeployState): string {
    const pupTrimmed = state.pup.map((p) => ({
      command: p.command,
      exitCode: p.exitCode,
      durationMs: p.durationMs,
      stdout: p.stdout.length > PUP_OUT_CAP
        ? p.stdout.slice(0, PUP_OUT_CAP) + `\n[...truncated ${p.stdout.length - PUP_OUT_CAP} bytes]`
        : p.stdout,
      stderr: p.stderr.slice(0, 4_000),
    }));
    const body = {
      source: "deploy-watch",
      pr: {
        key: state.prKey,
        number: state.prNumber,
        title: state.prTitle,
        url: state.prUrl,
        sha: state.sha,
      },
      runs: state.runs.map((r) => ({
        id: r.id,
        name: r.name,
        event: r.event,
        attempt: r.run_attempt,
        status: r.status,
        conclusion: r.conclusion,
        url: r.html_url,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      pup: pupTrimmed,
    };
    const intro =
      "Deploy finished — judge whether Datadog signal shows an anomaly. " +
      "If concerning, surface findings to the user. No auto-rollback.\n\n";
    let json = JSON.stringify(body, null, 2);
    if (intro.length + json.length > STEER_BUDGET) {
      const room = STEER_BUDGET - intro.length - 120;
      json = json.slice(0, room) + "\n[...truncated payload over budget]";
    }
    return intro + json;
  }

  return {
    start() {
      if (intervalHandle != null) return;
      intervalHandle = setInterval(() => {
        void tick().catch((err) => {
          if (isAbort(err)) return;
          ctx.ui.notify(`deploy-watch tick: ${err.message}`, "warning");
        });
      }, cfg.pollMs);
      void tick();
    },
    stop() {
      paused = true;
      if (intervalHandle != null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      controller.abort();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    status() {
      const rl = gh.getRateLimit();
      const repos = cfg.repos.map((r) => r.key).join(", ") || "(none)";
      const active = activeDeploys.size === 0
        ? "(none)"
        : Array.from(activeDeploys.keys()).join(", ");
      return [
        `deploy-watch ${paused ? "paused" : "running"}`,
        `repos: ${repos}`,
        `seen PRs: ${seenPrs.size}`,
        `active deploys: ${active}`,
        `pup commands: ${cfg.pupCommands.length}`,
        `gh ratelimit remaining: ${rl.remaining ?? "?"}`,
      ].join(" | ");
    },
  };
}
