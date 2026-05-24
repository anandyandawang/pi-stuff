/**
 * GITHUB_TOKEN end-to-end:
 *
 *  - Host: build the gondolin createHttpHooks `secrets` entry (placeholder
 *    swap for allowed github destinations).
 *  - Guest: rewrite SSH-style github remotes to HTTPS (createHttpHooks is
 *    HTTP-only) and register a git credential.helper that emits the
 *    placeholder $GITHUB_TOKEN. Gondolin swaps the placeholder for the
 *    real token on the wire for hosts in `githubTokenHosts`.
 *
 * The guest never sees the real token value.
 */

import type { VM } from "@earendil-works/gondolin";

export function buildSecrets(
  tokenHosts: string[] | undefined,
): Record<string, { hosts: string[]; value: string }> | undefined {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !tokenHosts || tokenHosts.length === 0) return undefined;
  return {
    GITHUB_TOKEN: { hosts: tokenHosts, value: token },
  };
}

export async function configureGitHubAuth(
  vm: VM,
  hasGithubToken: boolean,
): Promise<void> {
  // SSH egress on port 22 is not proxied. Rewrite SSH-style github remotes
  // to HTTPS so the token-swap proxy + credential.helper combo handles auth.
  const sshRewrites: Array<[string, string]> = [
    ["url.https://github.com/.insteadOf", "git@github.com:"],
    ["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
  ];
  for (const [key, value] of sshRewrites) {
    const r = await vm.exec([
      "/usr/bin/git",
      "config",
      "--global",
      "--add",
      key,
      value,
    ]);
    if (!r.ok) {
      throw new Error(
        `git config ${key} failed (${r.exitCode}): ${r.stderr}`,
      );
    }
  }

  if (!hasGithubToken) return;

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
