/**
 * Pi + Gondolin Sandbox Extension (customized)
 *
 * Based on upstream `host/examples/pi-gondolin.ts` from earendil-works/gondolin.
 * Adds:
 *   - Custom guest image (sandbox.imagePath: ../assets)
 *   - Deny-by-default network allowlist via createHttpHooks
 *   - GITHUB_TOKEN secret injection (guest sees placeholder)
 *   - Host git identity + GITHUB_USERNAME + proxy imported into guest env
 *   - Allowlist verification probe at startup
 *
 * Workspace mount: the directory you start `pi` in is mounted read-write at
 * `/workspace` inside the VM (upstream behavior, unchanged).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";

import {
  createHttpHooks,
  RealFSProvider,
  VM,
} from "@earendil-works/gondolin";

const GUEST_WORKSPACE = "/workspace";
const GUEST_PI_RUNTIME = "/pi-runtime";

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(EXT_DIR, "..");
const ASSETS_DIR = path.join(ROOT, "assets");
const ALLOWED_HOSTS_PATH = path.join(ROOT, "allowed-hosts.json");

// Pi's system prompt references pi-coding-agent's own docs/examples by
// their HOST install path. Without a second mount the model gets
// "path escapes workspace" for every doc lookup. Detect pi's package
// root from process.argv[1] (pi's CLI entry script) and mount it at
// /pi-runtime so the same host paths translate cleanly.
function resolvePiRuntimeRoot(): string | undefined {
  const entry = process.argv[1];
  if (!entry) return undefined;
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "@earendil-works/pi-coding-agent") {
          return dir;
        }
      } catch {
        // not a usable package.json, keep walking
      }
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

const PI_ROOT = resolvePiRuntimeRoot();

interface AllowedHostsConfig {
  allowed: string[];
  githubTokenHosts?: string[];
}

interface GitIdentity {
  name?: string;
  email?: string;
}

function shQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function tryTranslate(
  hostRoot: string,
  guestRoot: string,
  localPath: string,
): string | undefined {
  const rel = path.relative(hostRoot, localPath);
  if (rel === "") return guestRoot;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const posixRel = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join(guestRoot, posixRel);
}

function toGuestPath(localCwd: string, localPath: string): string {
  const ws = tryTranslate(localCwd, GUEST_WORKSPACE, localPath);
  if (ws !== undefined) return ws;
  if (PI_ROOT) {
    const pi = tryTranslate(PI_ROOT, GUEST_PI_RUNTIME, localPath);
    if (pi !== undefined) return pi;
  }
  throw new Error(`path escapes workspace: ${localPath}`);
}

function loadAllowedHosts(): AllowedHostsConfig {
  if (!existsSync(ALLOWED_HOSTS_PATH)) {
    throw new Error(`allowed-hosts.json not found at ${ALLOWED_HOSTS_PATH}`);
  }
  const parsed = JSON.parse(
    readFileSync(ALLOWED_HOSTS_PATH, "utf8"),
  ) as AllowedHostsConfig;
  if (!Array.isArray(parsed.allowed) || parsed.allowed.length === 0) {
    throw new Error(`allowed-hosts.json: "allowed" must be a non-empty array`);
  }
  return parsed;
}

function readHostGitIdentity(): GitIdentity {
  const get = (key: string): string | undefined => {
    try {
      const out = execSync(`git config --global --get ${key}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  };
  return { name: get("user.name"), email: get("user.email") };
}

function collectHostEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const pass = (key: string) => {
    const v = process.env[key];
    if (typeof v === "string" && v.length > 0) out[key] = v;
  };
  pass("GITHUB_USERNAME");
  pass("HTTPS_PROXY");
  pass("HTTP_PROXY");
  pass("NO_PROXY");
  return out;
}

function buildSecrets(
  tokenHosts: string[] | undefined,
): Record<string, { hosts: string[]; value: string }> | undefined {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !tokenHosts || tokenHosts.length === 0) return undefined;
  return {
    GITHUB_TOKEN: { hosts: tokenHosts, value: token },
  };
}

async function configureGuestGit(
  vm: VM,
  ident: GitIdentity,
  hasGithubToken: boolean,
): Promise<void> {
  // Host bind-mount preserves host uid on /workspace files; guest runs as
  // root. Without this, every git command in /workspace fails with
  // "detected dubious ownership". '*' is fine here because the VM is
  // single-tenant and ephemeral.
  const safe = await vm.exec([
    "/usr/bin/git",
    "config",
    "--global",
    "--add",
    "safe.directory",
    "*",
  ]);
  if (!safe.ok) {
    throw new Error(
      `git config safe.directory failed (${safe.exitCode}): ${safe.stderr}`,
    );
  }
  if (ident.name) {
    const r = await vm.exec([
      "/usr/bin/git",
      "config",
      "--global",
      "user.name",
      ident.name,
    ]);
    if (!r.ok) {
      throw new Error(
        `git config user.name failed (${r.exitCode}): ${r.stderr}`,
      );
    }
  }
  if (ident.email) {
    const r = await vm.exec([
      "/usr/bin/git",
      "config",
      "--global",
      "user.email",
      ident.email,
    ]);
    if (!r.ok) {
      throw new Error(
        `git config user.email failed (${r.exitCode}): ${r.stderr}`,
      );
    }
  }
  if (hasGithubToken) {
    // Tell git to use $GITHUB_TOKEN for HTTPS auth against github.com.
    // The token value visible inside the guest is the gondolin placeholder;
    // gondolin's HTTP proxy swaps it for the real token on the wire for
    // hosts listed in allowed-hosts.json -> githubTokenHosts.
    const helper =
      "!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f";
    const r = await vm.exec([
      "/usr/bin/git",
      "config",
      "--global",
      "credential.https://github.com.helper",
      helper,
    ]);
    if (!r.ok) {
      throw new Error(
        `git config credential.helper failed (${r.exitCode}): ${r.stderr}`,
      );
    }
  }
}

async function verifyAllowlist(vm: VM): Promise<void> {
  const allowed = await vm.exec([
    "/bin/sh",
    "-lc",
    "curl -sS -o /dev/null -w '%{http_code}' --max-time 5 https://api.github.com/zen",
  ]);
  if (!allowed.ok || !allowed.stdout.trim().startsWith("2")) {
    throw new Error(
      `allowlist verify: api.github.com unreachable (exit ${allowed.exitCode}, body ${allowed.stdout.trim()}, err ${allowed.stderr.trim()})`,
    );
  }
  const denied = await vm.exec([
    "/bin/sh",
    "-lc",
    "curl -sS -o /dev/null -w '%{http_code}' --max-time 5 https://example.com/ || echo BLOCKED",
  ]);
  const body = denied.stdout.trim();
  if (body.startsWith("2") || body.startsWith("3")) {
    throw new Error(
      `allowlist verify: example.com reachable (got ${body}) but should be blocked by network policy`,
    );
  }
}

// Host env keys that point at host paths/identities or carry real secrets.
// Pi forwards its process env to BashOperations.exec; if we don't strip
// these, guest bash sees HOME=/Users/... and the REAL GITHUB_TOKEN, which
// would defeat gondolin's placeholder swap.
const HOST_PATH_ENV_KEYS = new Set([
  "HOME",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "PWD",
  "OLDPWD",
  "TMPDIR",
  "PATH",
  "MANPATH",
  "INFOPATH",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "JAVA_HOME",
  "NODE_PATH",
  "npm_config_prefix",
  // Real secrets — must come from gondolin's createHttpHooks placeholder
  // map (guestSecretsEnv below), not from the host shell.
  "GITHUB_TOKEN",
]);

// Populated by ensureVm() after createHttpHooks. Contains the gondolin
// placeholder env (e.g. {GITHUB_TOKEN: "<opaque-placeholder>"}). Overlaid
// onto every per-call bash env so guest scripts always see a usable
// reference; gondolin swaps it on the wire for allowed destinations.
let guestSecretsEnv: Record<string, string> = {};

function sanitizeEnv(env?: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v !== "string") continue;
      if (HOST_PATH_ENV_KEYS.has(k)) continue;
      out[k] = v;
    }
  }
  // Force guest-valid defaults regardless of merge semantics with the
  // baked-in VM env. Aligns with the Alpine + openjdk21 image.
  out.HOME = "/root";
  out.USER = "root";
  out.LOGNAME = "root";
  out.SHELL = "/bin/bash";
  out.PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  out.JAVA_HOME = "/usr/lib/jvm/default-jvm";
  // Overlay placeholder secrets so guest scripts see a usable token value.
  for (const [k, v] of Object.entries(guestSecretsEnv)) {
    out[k] = v;
  }
  return out;
}

function createGondolinReadOps(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: async (p) => {
      const guestPath = toGuestPath(localCwd, p);
      const r = await vm.exec(["/bin/cat", guestPath]);
      if (!r.ok) {
        throw new Error(`cat failed (${r.exitCode}): ${r.stderr}`);
      }
      return r.stdoutBuffer;
    },
    access: async (p) => {
      const guestPath = toGuestPath(localCwd, p);
      const r = await vm.exec([
        "/bin/sh",
        "-lc",
        `test -r ${shQuote(guestPath)}`,
      ]);
      if (!r.ok) {
        throw new Error(`not readable: ${p}`);
      }
    },
    detectImageMimeType: async (p) => {
      const guestPath = toGuestPath(localCwd, p);
      try {
        const r = await vm.exec([
          "/bin/sh",
          "-lc",
          `file --mime-type -b ${shQuote(guestPath)}`,
        ]);
        if (!r.ok) return null;
        const m = r.stdout.trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
          m,
        )
          ? m
          : null;
      } catch {
        return null;
      }
    },
  };
}

function createGondolinWriteOps(vm: VM, localCwd: string): WriteOperations {
  return {
    writeFile: async (p, content) => {
      const guestPath = toGuestPath(localCwd, p);
      const dir = path.posix.dirname(guestPath);
      const b64 = Buffer.from(content, "utf8").toString("base64");
      const script = [
        `set -eu`,
        `mkdir -p ${shQuote(dir)}`,
        `echo ${shQuote(b64)} | base64 -d > ${shQuote(guestPath)}`,
      ].join("\n");
      const r = await vm.exec(["/bin/sh", "-lc", script]);
      if (!r.ok) {
        throw new Error(`write failed (${r.exitCode}): ${r.stderr}`);
      }
    },
    mkdir: async (dir) => {
      const guestDir = toGuestPath(localCwd, dir);
      const r = await vm.exec(["/bin/mkdir", "-p", guestDir]);
      if (!r.ok) {
        throw new Error(`mkdir failed (${r.exitCode}): ${r.stderr}`);
      }
    },
  };
}

function createGondolinEditOps(vm: VM, localCwd: string): EditOperations {
  const r = createGondolinReadOps(vm, localCwd);
  const w = createGondolinWriteOps(vm, localCwd);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function createGondolinBashOps(vm: VM, localCwd: string): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const guestCwd = toGuestPath(localCwd, cwd);

      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener("abort", onAbort, { once: true });

      let timedOut = false;
      const timer =
        timeout && timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              ac.abort();
            }, timeout * 1000)
          : undefined;

      try {
        const proc = vm.exec(["/bin/bash", "-lc", command], {
          cwd: guestCwd,
          signal: ac.signal,
          env: sanitizeEnv(env),
          stdout: "pipe",
          stderr: "pipe",
        });

        for await (const chunk of proc.output()) {
          onData(chunk.data);
        }

        const r = await proc;
        return { exitCode: r.exitCode };
      } catch (err) {
        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

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

      const { httpHooks, env: secretsEnv } = createHttpHooks({
        allowedHosts: hostsConfig.allowed,
        secrets,
      });
      // Cache for sanitizeEnv() so every per-call bash env carries the
      // placeholder; otherwise real host GITHUB_TOKEN would slip through
      // pi's env forwarding (stripped above) and there'd be no replacement.
      guestSecretsEnv = secretsEnv;

      const created = await VM.create({
        sandbox: { imagePath: ASSETS_DIR },
        httpHooks,
        env: { ...hostEnv, ...secretsEnv },
        vfs: {
          mounts: {
            [GUEST_WORKSPACE]: new RealFSProvider(localCwd),
            ...(PI_ROOT
              ? { [GUEST_PI_RUNTIME]: new RealFSProvider(PI_ROOT) }
              : {}),
          },
        },
      });

      try {
        await configureGuestGit(created, gitIdent, !!process.env.GITHUB_TOKEN);
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
