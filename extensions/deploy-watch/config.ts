/**
 * Config load. Pure + sync. Read env, validate, return typed shape or throw.
 * Caller turn throw into warn-notify.
 */

export interface DeployWatchConfig {
  githubToken: string;
  repos: Array<{ owner: string; repo: string; key: string }>;
  pupCommands: string[][];
  pupBin: string;
  pollMs: number;
  soakMs: number;
  workflowStartTimeoutMs: number;
  runPollMs: number;
}

function parseInt32(value: string | undefined, fallback: number, name: string): number {
  if (value == null || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer (got "${value}")`);
  }
  return n;
}

function parseRepos(raw: string): DeployWatchConfig["repos"] {
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) throw new Error("DEPLOY_WATCH_REPOS empty");
  return items.map((slug) => {
    const m = slug.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (!m) throw new Error(`DEPLOY_WATCH_REPOS entry not "owner/repo": ${slug}`);
    return { owner: m[1], repo: m[2], key: `${m[1]}/${m[2]}` };
  });
}

function parsePupCommands(raw: string | undefined): string[][] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`DEPLOY_WATCH_PUP_COMMANDS not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("DEPLOY_WATCH_PUP_COMMANDS must be a JSON array of string arrays");
  }
  return parsed.map((cmd, i) => {
    if (!Array.isArray(cmd) || cmd.some((a) => typeof a !== "string")) {
      throw new Error(`DEPLOY_WATCH_PUP_COMMANDS[${i}] must be array of strings`);
    }
    return cmd as string[];
  });
}

export function loadConfig(): DeployWatchConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error("GITHUB_TOKEN not set");

  const reposRaw = process.env.DEPLOY_WATCH_REPOS;
  if (!reposRaw) throw new Error("DEPLOY_WATCH_REPOS not set (CSV of owner/repo)");

  return {
    githubToken,
    repos: parseRepos(reposRaw),
    pupCommands: parsePupCommands(process.env.DEPLOY_WATCH_PUP_COMMANDS),
    pupBin: process.env.DEPLOY_WATCH_PUP_BIN || "pup",
    pollMs: parseInt32(process.env.DEPLOY_WATCH_POLL_MS, 60_000, "DEPLOY_WATCH_POLL_MS"),
    soakMs: parseInt32(process.env.DEPLOY_WATCH_SOAK_MS, 300_000, "DEPLOY_WATCH_SOAK_MS"),
    workflowStartTimeoutMs: parseInt32(
      process.env.DEPLOY_WATCH_WORKFLOW_START_TIMEOUT_MS,
      600_000,
      "DEPLOY_WATCH_WORKFLOW_START_TIMEOUT_MS",
    ),
    runPollMs: parseInt32(process.env.DEPLOY_WATCH_RUN_POLL_MS, 30_000, "DEPLOY_WATCH_RUN_POLL_MS"),
  };
}
