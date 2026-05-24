/**
 * Pi + Gondolin Sandbox Extension
 *
 * Pi-side wiring only. Each capability is owned by a sibling module:
 *
 *   mounts.ts          /workspace + pi-runtime + pi-installed mounts,
 *                      host->guest path translation, safe.directory
 *   github-auth.ts     GITHUB_TOKEN secret injection + git credential helper
 *                      + SSH->HTTPS rewrites
 *   git-identity.ts    host gitconfig user.name/user.email -> guest
 *   network-policy.ts  allowed-hosts.json loader + verify probe
 *   env-passthrough.ts env baking + per-bash-call env sanitization
 *   ops.ts             read/write/edit/bash op factories
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  createHttpHooks,
  ReadonlyProvider,
  RealFSProvider,
  VM,
} from "@earendil-works/gondolin";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";

import {
  collectHostEnv,
  setGuestSecretsEnv,
} from "./env-passthrough.ts";
import { applyGitIdentity, readHostGitIdentity } from "./git-identity.ts";
import { buildSecrets, configureGitHubAuth } from "./github-auth.ts";
import {
  aliasHostPaths,
  ASSETS_DIR,
  configureSafeDirectory,
  GUEST_WORKSPACE,
  prepareExtraMounts,
} from "./mounts.ts";
import { loadAllowedHosts, verifyAllowlist } from "./network-policy.ts";
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
} from "./ops.ts";

export default function (pi: ExtensionAPI) {
  const localCwd = process.cwd();

  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);

  let vm: VM | null = null;
  let vmStarting: Promise<VM> | null = null;

  async function ensureVm(ctx?: ExtensionContext): Promise<VM> {
    if (vm) return vm;
    if (vmStarting) return vmStarting;

    vmStarting = (async () => {
      if (!existsSync(path.join(ASSETS_DIR, "manifest.json"))) {
        throw new Error(
          `gondolin assets missing at ${ASSETS_DIR}. Run: npx gondolin build --config build-config.json --output ./assets`,
        );
      }

      // 1. Read host-side inputs.
      const hostsConfig = loadAllowedHosts();
      const gitIdent = readHostGitIdentity();
      const hostEnv = collectHostEnv();
      const secrets = buildSecrets(hostsConfig.githubTokenHosts);

      ctx?.ui.setStatus(
        "gondolin",
        ctx.ui.theme.fg(
          "accent",
          `Gondolin: starting (mount ${GUEST_WORKSPACE})`,
        ),
      );

      // 2. Build httpHooks + secret placeholder env. Cache the placeholder
      //    map so sanitizeEnv can overlay it on every per-call bash env.
      const { httpHooks, env: secretsEnv } = createHttpHooks({
        allowedHosts: hostsConfig.allowed,
        secrets,
      });
      setGuestSecretsEnv(secretsEnv);

      // 3. Resolve extra host dirs to expose (pi-coding-agent install dir +
      //    every local-path package pi tracks in settings.json).
      const extras = prepareExtraMounts(localCwd);
      const vfsMounts: Record<string, RealFSProvider | ReadonlyProvider> = {
        [GUEST_WORKSPACE]: new RealFSProvider(localCwd),
      };
      for (const m of extras) {
        vfsMounts[m.guestPath] = new ReadonlyProvider(
          new RealFSProvider(m.hostPath),
        );
      }

      // 4. Boot the VM.
      const created = await VM.create({
        sandbox: { imagePath: ASSETS_DIR },
        httpHooks,
        env: { ...hostEnv, ...secretsEnv },
        vfs: { mounts: vfsMounts },
      });

      // 5. Guest setup steps (one capability per line). Each is idempotent
      //    within a session; a single failure tears the VM back down.
      try {
        await configureSafeDirectory(created);
        await applyGitIdentity(created, gitIdent);
        await configureGitHubAuth(created, !!process.env.GITHUB_TOKEN);
        await aliasHostPaths(created);
        await verifyAllowlist(created);
      } catch (err) {
        await created.close().catch(() => {});
        throw err;
      }

      vm = created;
      ctx?.ui.setStatus(
        "gondolin",
        ctx.ui.theme.fg(
          "accent",
          `Gondolin: running (${localCwd} -> ${GUEST_WORKSPACE})`,
        ),
      );
      ctx?.ui.notify(
        `Gondolin VM ready. Host ${localCwd} mounted at ${GUEST_WORKSPACE}`,
        "info",
      );
      return created;
    })();

    try {
      return await vmStarting;
    } catch (err) {
      vmStarting = null;
      throw err;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await ensureVm(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!vm) return;
    ctx.ui.setStatus(
      "gondolin",
      ctx.ui.theme.fg("muted", "Gondolin: stopping"),
    );
    try {
      await vm.close();
    } finally {
      vm = null;
      vmStarting = null;
    }
  });

  pi.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createReadTool(localCwd, {
        operations: createGondolinReadOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createWriteTool(localCwd, {
        operations: createGondolinWriteOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createEditTool(localCwd, {
        operations: createGondolinEditOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localBash,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createBashTool(localCwd, {
        operations: createGondolinBashOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.on("user_bash", (_event, _ctx) => {
    if (!vm) return;
    return { operations: createGondolinBashOps(vm, localCwd) };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    await ensureVm(ctx);
    const modified = event.systemPrompt.replace(
      `Current working directory: ${localCwd}`,
      `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM, mounted from host: ${localCwd})`,
    );
    return { systemPrompt: modified };
  });
}
