/**
 * Env crossing host -> guest, in two channels:
 *
 *  1. Baked into VM.create's `env` option once at session start:
 *     `collectHostEnv()` returns the small allowlist of host vars we want
 *     forwarded (GITHUB_USERNAME, proxy vars).
 *
 *  2. Pi forwards its own process env to every BashOperations.exec call.
 *     `sanitizeEnv` strips host-only keys (HOME, PATH, JAVA_HOME, ...) and
 *     the real GITHUB_TOKEN, then forces guest-valid defaults and overlays
 *     the placeholder secrets from createHttpHooks. Without the strip+
 *     overlay, the real token would slip into guest scripts.
 */

let guestSecretsEnv: Record<string, string> = {};

export function setGuestSecretsEnv(env: Record<string, string>): void {
  guestSecretsEnv = env;
}

export function collectHostEnv(): Record<string, string> {
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

// Host env keys that point at host paths/identities or carry real secrets.
// Pi forwards its process env to BashOperations.exec; if we don't strip
// these, guest bash sees HOME=/Users/... and the REAL GITHUB_TOKEN.
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
  // map (guestSecretsEnv), not from the host shell.
  "GITHUB_TOKEN",
]);

export function sanitizeEnv(env?: NodeJS.ProcessEnv): Record<string, string> {
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
  // gondolin's guest init mounts /root as tmpfs (~RAM-quartered), which
  // overflows fast under gradle/maven/npm caches. /home is left on the
  // rootfs ext4; /home/agent is created at image build time.
  out.HOME = "/home/agent";
  out.USER = "root";
  out.LOGNAME = "root";
  out.SHELL = "/bin/bash";
  out.PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  out.JAVA_HOME = "/usr/lib/jvm/java-21-openjdk";
  // Overlay placeholder secrets so guest scripts see a usable token value.
  for (const [k, v] of Object.entries(guestSecretsEnv)) {
    out[k] = v;
  }
  return out;
}
