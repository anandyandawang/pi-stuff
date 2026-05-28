/**
 * Polling loop: every interval, query GH for the viewer's open PRs,
 * skip ones already reviewed at the current head SHA, fan out reviews,
 * post results.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { aggregateMarkdown, runReviews } from "./reviewer.ts";

export type PollerConfig = {
  models: string[];
  intervalMs: number;
  dryRun: boolean;
  includeDrafts: boolean;
};

type PullRequest = {
  url: string;
  number: number;
  title: string;
  headRefOid: string;
  isDraft: boolean;
  repository: { nameWithOwner: string };
};

export type PollerState = {
  running: boolean;
  config: PollerConfig | null;
  seen: Set<string>;
  timer: NodeJS.Timeout | null;
  cycleInFlight: boolean;
  abortCtl: AbortController | null;
  lastTickAt: number | null;
  lastError: string | null;
};

export function emptyState(): PollerState {
  return {
    running: false,
    config: null,
    seen: new Set(),
    timer: null,
    cycleInFlight: false,
    abortCtl: null,
    lastTickAt: null,
    lastError: null,
  };
}

function execCapture(cmd: string, args: string[], stdin?: string): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (e) => resolve({ ok: false, stdout, stderr: e.message, code: null }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr, code }));
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

async function listOpenPrs(): Promise<{ ok: boolean; prs: PullRequest[]; error?: string }> {
  const r = await execCapture("gh", [
    "search",
    "prs",
    "--author=@me",
    "--state=open",
    "--json",
    "url,number,title,repository",
    "--limit",
    "50",
  ]);
  if (!r.ok) return { ok: false, prs: [], error: r.stderr.trim() || `gh exit ${r.code}` };
  let parsed: Array<{ url: string; number: number; title: string; repository: { nameWithOwner: string } }>;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    return { ok: false, prs: [], error: `parse failed: ${(e as Error).message}` };
  }

  // gh search prs does not return headRefOid or isDraft; fetch per-PR.
  const enriched: PullRequest[] = [];
  for (const p of parsed) {
    const detail = await execCapture("gh", [
      "pr",
      "view",
      String(p.number),
      "-R",
      p.repository.nameWithOwner,
      "--json",
      "headRefOid,isDraft",
    ]);
    if (!detail.ok) continue;
    try {
      const d = JSON.parse(detail.stdout) as { headRefOid: string; isDraft: boolean };
      enriched.push({ ...p, headRefOid: d.headRefOid, isDraft: d.isDraft });
    } catch {
      // skip
    }
  }
  return { ok: true, prs: enriched };
}

async function fetchDiff(pr: PullRequest): Promise<string> {
  const r = await execCapture("gh", ["pr", "diff", String(pr.number), "-R", pr.repository.nameWithOwner]);
  if (!r.ok) return `[failed to fetch diff: ${r.stderr.trim() || `gh exit ${r.code}`}]`;
  const max = 200 * 1024;
  if (r.stdout.length > max) {
    return r.stdout.slice(0, max) + `\n\n[diff truncated at ${max} bytes]`;
  }
  return r.stdout;
}

function buildPrompt(pr: PullRequest, diff: string): string {
  return [
    `You are a code reviewer for PR "${pr.title}" (${pr.url}).`,
    `Focus on correctness bugs, security issues, regressions, and reuse opportunities.`,
    `One concise paragraph per issue. No praise. No restatement of the diff.`,
    `If nothing material, say "no findings".`,
    ``,
    `Diff:`,
    `\`\`\`diff`,
    diff,
    `\`\`\``,
  ].join("\n");
}

async function postPrComment(pr: PullRequest, body: string): Promise<{ ok: boolean; error?: string }> {
  const r = await execCapture("gh", ["pr", "comment", String(pr.number), "-R", pr.repository.nameWithOwner, "-F", "-"], body);
  if (!r.ok) return { ok: false, error: r.stderr.trim() || `gh exit ${r.code}` };
  return { ok: true };
}

export function seenKey(pr: PullRequest): string {
  return `${pr.url}@${pr.headRefOid}`;
}

export async function runCycle(
  state: PollerState,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (!state.config) return;
  if (state.cycleInFlight) return;
  state.cycleInFlight = true;
  state.lastTickAt = Date.now();
  state.abortCtl = new AbortController();
  try {
    const list = await listOpenPrs();
    if (!list.ok) {
      state.lastError = list.error ?? null;
      if (ctx.hasUI) ctx.ui.notify(`pr-reviewer: gh failed — ${list.error}`, "warning");
      return;
    }
    state.lastError = null;

    const candidates = list.prs.filter((pr) => {
      if (pr.isDraft && !state.config!.includeDrafts) return false;
      return !state.seen.has(seenKey(pr));
    });

    for (const pr of candidates) {
      if (state.abortCtl.signal.aborted) break;
      if (ctx.hasUI) ctx.ui.notify(`pr-reviewer: reviewing #${pr.number} (${pr.title})`, "info");
      const diff = await fetchDiff(pr);
      const prompt = buildPrompt(pr, diff);
      const reviews = await runReviews(state.config.models, prompt, ctx.cwd, state.abortCtl.signal);
      const aggregated = aggregateMarkdown(reviews, pr.title, pr.url);

      await pi.sendUserMessage(aggregated, { deliverAs: "steer" });

      const anyOk = reviews.some((r) => r.ok);
      if (!state.config.dryRun && anyOk) {
        const post = await postPrComment(pr, aggregated);
        if (!post.ok && ctx.hasUI) ctx.ui.notify(`pr-reviewer: post failed — ${post.error}`, "warning");
      }

      state.seen.add(seenKey(pr));
      pi.appendEntry("pr-reviewer:seen", { key: seenKey(pr), at: Date.now() });

      if (ctx.hasUI) {
        const okCount = reviews.filter((r) => r.ok).length;
        ctx.ui.notify(`pr-reviewer: #${pr.number} done (${okCount}/${reviews.length} models)`, "info");
      }
    }
  } catch (e) {
    state.lastError = (e as Error).message;
    if (ctx.hasUI) ctx.ui.notify(`pr-reviewer: cycle error — ${state.lastError}`, "error");
  } finally {
    state.cycleInFlight = false;
    state.abortCtl = null;
  }
}

export function start(
  state: PollerState,
  config: PollerConfig,
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | null,
): void {
  stop(state);
  state.config = config;
  state.running = true;
  state.timer = setInterval(() => {
    const ctx = getCtx();
    if (!ctx) return;
    void runCycle(state, pi, ctx);
  }, config.intervalMs);
}

export function stop(state: PollerState): void {
  state.running = false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.abortCtl) {
    state.abortCtl.abort();
    state.abortCtl = null;
  }
}
