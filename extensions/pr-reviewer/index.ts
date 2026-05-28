/**
 * pr-reviewer extension.
 *
 * Polls the current GitHub viewer's open PRs and fans each new (PR, head SHA)
 * out to N reviewer subagents — one pi child process per user-supplied model.
 * Aggregated review is posted to the TUI as a steer message and (unless
 * --dry-run) to the PR as a comment via `gh pr comment`.
 *
 * Slash command:
 *   /pr-review start --models <m1,m2,...> --interval <Ns|Nm|Nh> [--dry-run] [--include-drafts]
 *   /pr-review stop
 *   /pr-review status
 *   /pr-review now
 *   /pr-review reset
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  emptyState,
  type PollerConfig,
  type PollerState,
  runCycle,
  start,
  stop,
} from "./poller.ts";

const CONFIG_ENTRY = "pr-reviewer:config";
const SEEN_ENTRY = "pr-reviewer:seen";
const RUNNING_ENTRY = "pr-reviewer:running";

function parseInterval(raw: string): number | null {
  const m = raw.match(/^(\d+)([smh])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return null;
}

type ParsedArgs = {
  sub: string;
  flags: Record<string, string | boolean>;
};

function parseArgs(raw: string): ParsedArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const sub = tokens.shift() ?? "";
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith("--")) continue;
    const eq = t.indexOf("=");
    if (eq >= 0) {
      flags[t.slice(2, eq)] = t.slice(eq + 1);
    } else {
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { sub, flags };
}

function buildConfigFromFlags(
  flags: Record<string, string | boolean>,
  prev: PollerConfig | null,
): { ok: true; config: PollerConfig } | { ok: false; error: string } {
  const modelsRaw = flags["models"];
  const models = typeof modelsRaw === "string"
    ? modelsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : prev?.models ?? [];
  if (models.length === 0) {
    return { ok: false, error: "no models — pass --models <m1,m2,...>" };
  }

  const intervalRaw = flags["interval"];
  let intervalMs: number;
  if (typeof intervalRaw === "string") {
    const parsed = parseInterval(intervalRaw);
    if (parsed === null || parsed < 5000) {
      return { ok: false, error: `bad --interval "${intervalRaw}" (need e.g. 30s, 5m, 1h; min 5s)` };
    }
    intervalMs = parsed;
  } else {
    intervalMs = prev?.intervalMs ?? 5 * 60 * 1000;
  }

  const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true"
    ? true
    : flags["dry-run"] === "false"
      ? false
      : prev?.dryRun ?? false;

  const includeDrafts = flags["include-drafts"] === true || flags["include-drafts"] === "true"
    ? true
    : flags["include-drafts"] === "false"
      ? false
      : prev?.includeDrafts ?? false;

  return { ok: true, config: { models, intervalMs, dryRun, includeDrafts } };
}

function formatStatus(state: PollerState): string {
  const cfg = state.config;
  const lines = [
    `running: ${state.running}`,
    cfg ? `models: ${cfg.models.join(", ")}` : "models: (none)",
    cfg ? `interval: ${Math.round(cfg.intervalMs / 1000)}s` : "interval: (unset)",
    cfg ? `dryRun: ${cfg.dryRun}` : "",
    cfg ? `includeDrafts: ${cfg.includeDrafts}` : "",
    `seen PRs (by sha): ${state.seen.size}`,
    `last tick: ${state.lastTickAt ? new Date(state.lastTickAt).toISOString() : "never"}`,
    state.lastError ? `last error: ${state.lastError}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export default function (pi: ExtensionAPI) {
  const state: PollerState = emptyState();
  let liveCtx: ExtensionContext | null = null;

  pi.on("session_start", async (_event, ctx) => {
    liveCtx = ctx;

    // Restore persisted seen set + last config + running flag.
    const entries = ctx.sessionManager.getEntries?.() ?? [];
    let lastConfig: PollerConfig | null = null;
    let wasRunning = false;
    for (const entry of entries as Array<{ customType?: string; data?: unknown }>) {
      if (entry.customType === SEEN_ENTRY) {
        const d = entry.data as { key?: string } | undefined;
        if (d?.key) state.seen.add(d.key);
      } else if (entry.customType === CONFIG_ENTRY) {
        lastConfig = entry.data as PollerConfig;
      } else if (entry.customType === RUNNING_ENTRY) {
        wasRunning = (entry.data as { running?: boolean })?.running ?? false;
      }
    }

    if (lastConfig && wasRunning) {
      start(state, lastConfig, pi, () => liveCtx);
      if (ctx.hasUI) {
        ctx.ui.notify(`pr-reviewer: resumed (${lastConfig.models.length} models, ${Math.round(lastConfig.intervalMs / 1000)}s)`, "info");
      }
    } else if (lastConfig) {
      state.config = lastConfig;
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    stop(state);
    liveCtx = null;
  });

  pi.registerCommand("pr-review", {
    description: "poll my open PRs and fan out reviews across N models",
    handler: async (raw: string, ctx: ExtensionCommandContext) => {
      const { sub, flags } = parseArgs(raw);
      liveCtx = ctx;

      switch (sub) {
        case "start": {
          const built = buildConfigFromFlags(flags, state.config);
          if (!built.ok) {
            ctx.ui.notify(`pr-review: ${built.error}`, "error");
            return;
          }
          start(state, built.config, pi, () => liveCtx);
          pi.appendEntry(CONFIG_ENTRY, built.config);
          pi.appendEntry(RUNNING_ENTRY, { running: true });
          ctx.ui.notify(
            `pr-review: started — ${built.config.models.length} models, every ${Math.round(built.config.intervalMs / 1000)}s${built.config.dryRun ? " (dry-run)" : ""}`,
            "info",
          );
          // Kick a cycle immediately rather than waiting one interval.
          void runCycle(state, pi, ctx);
          return;
        }
        case "stop": {
          stop(state);
          pi.appendEntry(RUNNING_ENTRY, { running: false });
          ctx.ui.notify("pr-review: stopped", "info");
          return;
        }
        case "status": {
          await pi.sendUserMessage(
            "```\n" + formatStatus(state) + "\n```",
            { deliverAs: "steer" },
          );
          return;
        }
        case "now": {
          if (!state.config) {
            ctx.ui.notify("pr-review: not configured — run /pr-review start first", "error");
            return;
          }
          ctx.ui.notify("pr-review: running one cycle now", "info");
          void runCycle(state, pi, ctx);
          return;
        }
        case "reset": {
          state.seen.clear();
          // No way to delete prior entries; just stop trusting them.
          pi.appendEntry(SEEN_ENTRY, { key: "__reset__", at: Date.now() });
          ctx.ui.notify("pr-review: seen set cleared", "info");
          return;
        }
        case "":
        case "help": {
          ctx.ui.notify(
            "pr-review: start --models a,b --interval 5m [--dry-run] [--include-drafts] | stop | status | now | reset",
            "info",
          );
          return;
        }
        default: {
          ctx.ui.notify(`pr-review: unknown subcommand "${sub}"`, "error");
          return;
        }
      }
    },
  });
}
