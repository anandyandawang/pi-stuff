/**
 * Host git identity -> guest. Reads `user.name` / `user.email` from the
 * host's global gitconfig and applies them inside the guest so commits
 * authored in /workspace carry the correct author.
 *
 * Either value missing on the host is silently skipped.
 */

import { execSync } from "node:child_process";

import type { VM } from "@earendil-works/gondolin";

export interface GitIdentity {
  name?: string;
  email?: string;
}

export function readHostGitIdentity(): GitIdentity {
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

export async function applyGitIdentity(
  vm: VM,
  ident: GitIdentity,
): Promise<void> {
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
}
