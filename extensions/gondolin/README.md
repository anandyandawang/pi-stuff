# Gondolin

Sandbox tool calls in a micro-VM with OpenJDK 21.

## Install

See [root README](../../README.md).

## Quick Info

- **Env**: Alpine + JVM toolchain.
- **Network**: Deny-by-default (see `allowed-hosts.json`).
- **Git**: Uses host identity.

## Config

- `build-config.json`: Change `arch` if not on ARM.
- `allowed-hosts.json`: Add hosts to allowlist.

## Rebuild

If you change the config, rebuild the image:
```bash
npx gondolin build --config build-config.json --output ./assets
```
