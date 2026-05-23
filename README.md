# pi-extensions

Personal collection of pi extensions. Each subdirectory is an independent
pi-package; install separately.

## Extensions

| Folder | What it does |
|---|---|
| [gondolin/](./gondolin) | Sandbox pi tool calls inside a Gondolin micro-VM (JVM toolchain) |

## Install

Clone once, then `pi install` each subdir you want. Pi records the path in
its settings without copying, so `git pull` updates take effect immediately.

```bash
git clone git@github.com:anandyandawang/pi-extensions ~/code/pi-extensions
cd ~/code/pi-extensions/<subdir>
pnpm install
# follow subdir-specific build/setup steps (see subdir README)
pi install "$PWD"           # user-global  (~/.pi/agent/settings.json)
# or
pi install "$PWD" -l        # project-local (.pi/settings.json in current cwd)
```

Ad-hoc (no install, one-shot): `pi -e <subdir>/extensions/<file>.ts`.
