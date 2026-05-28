/**
 * Datadog pup CLI subprocess wrapper. execFile (no shell). Inherits env so
 * OAuth keychain session or DD_API_KEY/DD_APP_KEY both work.
 *
 * Never throw on subprocess failure: caller surface stderr via notify/steer.
 */

import { execFile } from "node:child_process";

export interface PupResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string[];
  durationMs: number;
}

const MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export function runPup(
  bin: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<PupResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = execFile(
      bin,
      args,
      { maxBuffer: MAX_BUFFER, timeout: timeoutMs, signal },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - start;
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({
            exitCode: -1,
            stdout: "",
            stderr: `pup binary not found: ${bin}`,
            command: args,
            durationMs,
          });
          return;
        }
        if (err && (err as any).name === "AbortError") {
          resolve({
            exitCode: -1,
            stdout: stdout?.toString() ?? "",
            stderr: "aborted",
            command: args,
            durationMs,
          });
          return;
        }
        const exitCode =
          (err as any)?.code != null && typeof (err as any).code === "number"
            ? (err as any).code
            : child.exitCode ?? (err ? 1 : 0);
        resolve({
          exitCode,
          stdout: (stdout ?? "").toString(),
          stderr: (stderr ?? "").toString(),
          command: args,
          durationMs,
        });
      },
    );
  });
}

/** Quick auth probe at startup. true = pup ready + authenticated. */
export async function checkPupAuth(
  bin: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  const r = await runPup(bin, ["auth", "status"], signal, 10_000);
  if (r.exitCode === -1 && r.stderr.startsWith("pup binary not found")) {
    return { ok: false, message: r.stderr };
  }
  if (r.exitCode === 0) {
    return { ok: true, message: r.stdout.trim().split("\n")[0] || "pup authenticated" };
  }
  return {
    ok: false,
    message: `pup auth status exit ${r.exitCode}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`,
  };
}
