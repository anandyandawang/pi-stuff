/**
 * Pi + deploy-watch
 *
 * Background poll merged PRs in configured repos -> follow GitHub Actions
 * workflow runs to conclusion -> concurrently gather Datadog signal via
 * `pup` CLI -> hand combined data to the agent via steer + notify. Agent
 * judge whether signal show anomaly. No auto-rollback.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { loadConfig } from "./config.ts";
import { checkPupAuth, runPup } from "./pup.ts";
import { createWatcher, type Watcher } from "./watcher.ts";

export default function (pi: ExtensionAPI) {
  let watcher: Watcher | null = null;
  let pupBin = "pup";

  pi.on("session_start", async (_event, ctx) => {
    try {
      const cfg = loadConfig();
      pupBin = cfg.pupBin;
      watcher = createWatcher(cfg, ctx, pi);
      watcher.start();
      ctx.ui.notify(
        `deploy-watch: watching ${cfg.repos.length} repo(s) every ${Math.round(cfg.pollMs / 1000)}s`,
        "info",
      );

      // Probe pup auth once so misconfig caught early. Non-fatal.
      if (cfg.pupCommands.length > 0) {
        const probe = await checkPupAuth(cfg.pupBin, AbortSignal.timeout(10_000));
        ctx.ui.notify(`deploy-watch: ${probe.message}`, probe.ok ? "info" : "warning");
      }
    } catch (err: any) {
      ctx.ui.notify(`deploy-watch disabled: ${err.message}`, "warning");
    }
  });

  pi.on("session_shutdown", async () => {
    watcher?.stop();
    watcher = null;
  });

  pi.registerCommand("deploy-watch", {
    description: "Control deploy-watch: status | pause | resume",
    handler: async (args, ctx) => {
      if (!watcher) {
        ctx.ui.notify("deploy-watch not initialized (check env vars)", "warning");
        return;
      }
      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "" || sub === "status") {
        ctx.ui.notify(watcher.status(), "info");
      } else if (sub === "pause") {
        watcher.pause();
        ctx.ui.notify("deploy-watch paused", "info");
      } else if (sub === "resume") {
        watcher.resume();
        ctx.ui.notify("deploy-watch resumed", "info");
      } else {
        ctx.ui.notify(`deploy-watch: unknown subcommand "${sub}"`, "warning");
      }
    },
  });

  pi.registerTool({
    name: "query_datadog",
    label: "Query Datadog (pup)",
    description:
      "Run a Datadog `pup` CLI subcommand and return its stdout. Use after a deploy-watch steer to inspect specific metrics, monitors, logs, or dashboards. Pass argv as an array (no shell).",
    promptGuidelines: [
      "Pass argv as a string array, e.g. [\"monitors\",\"list\",\"--output\",\"json\",\"--tag\",\"service:foo\"].",
      "Prefer JSON output (--output json) so you can reason about structured data.",
      "Quote nothing — array elements go straight to execve.",
    ],
    parameters: Type.Object({
      command: Type.Array(Type.String(), {
        description: "Arguments passed to pup, e.g. [\"metrics\",\"query\",\"--query\",\"...\"]",
      }),
    }),
    async execute(_toolCallId, params, signal) {
      const r = await runPup(pupBin, params.command, signal);
      const out = r.stdout || r.stderr || "(no output)";
      const trimmed = out.length > 50_000
        ? out.slice(0, 50_000) + `\n[...truncated ${out.length - 50_000} bytes]`
        : out;
      return {
        content: [{ type: "text", text: trimmed }],
        details: {
          command: params.command,
          exitCode: r.exitCode,
          durationMs: r.durationMs,
        },
      };
    },
  });
}
