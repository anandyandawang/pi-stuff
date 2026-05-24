/**
 * Egress allowlist end-to-end.
 *
 *  - Host: load `allowed-hosts.json` (passed into createHttpHooks).
 *  - Guest: probe one allowed + one denied host at startup to confirm the
 *    policy is actually in force; throw if either side surprises.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { VM } from "@earendil-works/gondolin";

import { ROOT } from "./mounts.ts";

export const ALLOWED_HOSTS_PATH = path.join(ROOT, "allowed-hosts.json");

export interface AllowedHostsConfig {
  allowed: string[];
  githubTokenHosts?: string[];
}

export function loadAllowedHosts(): AllowedHostsConfig {
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

export async function verifyAllowlist(vm: VM): Promise<void> {
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
