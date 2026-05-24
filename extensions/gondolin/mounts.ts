/**
 * Guest filesystem topology — everything related to which host dirs the
 * guest can see and how host abs paths translate to guest paths.
 *
 *  - `/workspace`        the host cwd that pi was launched in (read-write)
 *  - `/pi-runtime`       pi-coding-agent's host install dir (read-only)
 *  - `/pi-installed/N`   each local-path pi package recorded in settings
 *
 * In addition to the VFS mounts, this module creates symlinks inside the
 * guest at each extra mount's HOST path -> guest path, so shell commands
 * (`ls /Users/.../pi-coding-agent/docs`) resolve in addition to read/edit
 * tool calls (which go through `toGuestPath`).
 *
 * Also owns `safe.directory '*'` setup, since the cause is the workspace
 * bind-mount (host uid != guest root) — same root issue as the mount itself.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { VM } from "@earendil-works/gondolin";

export const GUEST_WORKSPACE = "/workspace";
const GUEST_PI_RUNTIME = "/pi-runtime";
const GUEST_PI_INSTALLED_PREFIX = "/pi-installed";

// Package root. Sibling .ts modules live alongside this file.
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.join(ROOT, "assets");

// POSIX shell quoting: wraps in single quotes and escapes internal quotes.
// Exported because ops.ts also builds shell scripts.
export function shQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

// ── extra mount state ──────────────────────────────────────────────────────

export interface ExtraMount {
  hostPath: string;
  guestPath: string;
  label: string;
}

let extraMounts: ExtraMount[] = [];

export function getExtraMounts(): readonly ExtraMount[] {
  return extraMounts;
}

// ── host -> guest path translation ─────────────────────────────────────────

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

export function toGuestPath(localCwd: string, localPath: string): string {
  const ws = tryTranslate(localCwd, GUEST_WORKSPACE, localPath);
  if (ws !== undefined) return ws;
  for (const m of extraMounts) {
    const t = tryTranslate(m.hostPath, m.guestPath, localPath);
    if (t !== undefined) return t;
  }
  throw new Error(`path escapes workspace: ${localPath}`);
}

// ── discovery: pi-coding-agent install dir ─────────────────────────────────

function findPiPackageRoot(start: string): string | undefined {
  let dir = path.dirname(start);
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

function resolvePiRuntimeRoot(): string | undefined {
  const seen = new Set<string>();
  const tryStart = (p: string | undefined): string | undefined => {
    if (!p || seen.has(p)) return undefined;
    seen.add(p);
    return findPiPackageRoot(p);
  };

  // process.argv[1] = `pi` entry. npm installs symlink ~/.../bin/pi to
  // ~/.../lib/node_modules/.../dist/cli.js; realpathSync follows it so the
  // walk reaches the real package dir.
  const argv1 = process.argv[1];
  if (argv1) {
    let real: string | undefined;
    try {
      real = realpathSync(argv1);
    } catch {
      /* ignore */
    }
    const root = tryStart(real) ?? tryStart(argv1);
    if (root) return root;
  }

  // Module resolver fallback. May resolve to our vendored copy under
  // gondolin/node_modules; reject anything inside our extension folder.
  try {
    const requireFromHere = createRequire(import.meta.url);
    const resolved = requireFromHere.resolve(
      "@earendil-works/pi-coding-agent",
    );
    const root = tryStart(resolved);
    if (root && !root.startsWith(ROOT)) return root;
  } catch {
    /* ignore */
  }
  return undefined;
}

// ── discovery: pi settings.json local-path packages ────────────────────────

interface LoadedSettings {
  baseDir: string;
  raw: unknown;
}

// Pi resolves relative paths in settings files against the file's own dir:
// ~/.pi/agent/settings.json -> baseDir is ~/.pi/agent.
function loadPiSettingsFiles(localCwd: string): LoadedSettings[] {
  const candidates: Array<{ baseDir: string; file: string }> = [];
  if (process.env.HOME) {
    const baseDir = path.join(process.env.HOME, ".pi", "agent");
    candidates.push({ baseDir, file: path.join(baseDir, "settings.json") });
  }
  {
    const baseDir = path.join(localCwd, ".pi");
    candidates.push({ baseDir, file: path.join(baseDir, "settings.json") });
  }
  const out: LoadedSettings[] = [];
  for (const c of candidates) {
    if (!existsSync(c.file)) continue;
    try {
      out.push({
        baseDir: c.baseDir,
        raw: JSON.parse(readFileSync(c.file, "utf8")),
      });
    } catch {
      /* ignore malformed settings */
    }
  }
  return out;
}

// Strings that look like remote sources (npm:..., git:..., https://..., etc)
// must NOT be treated as filesystem paths.
function isLocalPathLike(value: string): boolean {
  if (!value) return false;
  if (value.startsWith("npm:")) return false;
  if (value.startsWith("git:")) return false;
  if (value.startsWith("git@")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  return true;
}

// Walk every relevant settings key, resolve relative paths against baseDir,
// expand leading `~`, exists-check, then emit canonical absolute paths.
function collectInstalledLocalPaths(localCwd: string): string[] {
  const stringArrayKeys = ["extensions", "skills", "prompts", "themes"];
  const out = new Set<string>();
  const tryAdd = (candidate: unknown, baseDir: string) => {
    if (typeof candidate !== "string") return;
    if (!isLocalPathLike(candidate)) return;
    let resolved = candidate;
    if (resolved.startsWith("~") && process.env.HOME) {
      resolved = path.join(process.env.HOME, resolved.slice(1));
    }
    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(baseDir, resolved);
    }
    if (!existsSync(resolved)) return;
    let real = resolved;
    try {
      real = realpathSync(resolved);
    } catch {
      /* ignore */
    }
    out.add(real);
  };
  for (const { baseDir, raw } of loadPiSettingsFiles(localCwd)) {
    if (!raw || typeof raw !== "object") continue;
    const settings = raw as Record<string, unknown>;
    for (const key of stringArrayKeys) {
      const arr = settings[key];
      if (Array.isArray(arr)) for (const v of arr) tryAdd(v, baseDir);
    }
    const pkgs = settings.packages;
    if (Array.isArray(pkgs)) {
      for (const p of pkgs) {
        if (typeof p === "string") tryAdd(p, baseDir);
        else if (p && typeof p === "object") {
          const obj = p as Record<string, unknown>;
          tryAdd(obj.source ?? obj.path ?? obj.location, baseDir);
        }
      }
    }
  }
  return [...out];
}

// ── public API: compute mounts, install them, sync to guest ────────────────

// Build the ExtraMount list and cache it for toGuestPath(). Return both so
// the caller can use the list to construct VM.create's vfs.mounts dict.
export function prepareExtraMounts(localCwd: string): readonly ExtraMount[] {
  const mounts: ExtraMount[] = [];
  const seen = new Set<string>();
  let localCwdReal = localCwd;
  try {
    localCwdReal = realpathSync(localCwd);
  } catch {
    /* ignore */
  }

  const add = (hostPath: string, guestPath: string, label: string): void => {
    let real = hostPath;
    try {
      real = realpathSync(hostPath);
    } catch {
      /* ignore */
    }
    if (real === localCwdReal) return; // already mounted as /workspace
    if (seen.has(real)) return;
    seen.add(real);
    mounts.push({ hostPath: real, guestPath, label });
  };

  const piRoot = resolvePiRuntimeRoot();
  if (piRoot) add(piRoot, GUEST_PI_RUNTIME, "pi-coding-agent");

  let i = 0;
  for (const p of collectInstalledLocalPaths(localCwd)) {
    add(p, `${GUEST_PI_INSTALLED_PREFIX}/${i++}`, path.basename(p));
  }

  extraMounts = mounts;
  return mounts;
}

// Bash commands aren't path-translated (only read/write/edit tool params
// are). Symlink each extra mount's HOST path -> guest path in the guest
// so `ls /Users/.../<pkg>/...` resolves to the read-only VFS mount.
export async function aliasHostPaths(vm: VM): Promise<void> {
  for (const m of extraMounts) {
    const parent = path.dirname(m.hostPath);
    const r = await vm.exec([
      "/bin/sh",
      "-lc",
      `mkdir -p ${shQuote(parent)} && ln -sfn ${shQuote(m.guestPath)} ${shQuote(m.hostPath)}`,
    ]);
    if (!r.ok) {
      throw new Error(
        `alias ${m.label} symlink failed (${r.exitCode}): ${r.stderr}`,
      );
    }
  }
}

// Host bind-mount preserves host uid on /workspace files; guest runs as
// root. Without this, every git command in /workspace fails with
// "detected dubious ownership". '*' is fine here because the VM is
// single-tenant and ephemeral.
export async function configureSafeDirectory(vm: VM): Promise<void> {
  const r = await vm.exec([
    "/usr/bin/git",
    "config",
    "--global",
    "--add",
    "safe.directory",
    "*",
  ]);
  if (!r.ok) {
    throw new Error(
      `git config safe.directory failed (${r.exitCode}): ${r.stderr}`,
    );
  }
}
