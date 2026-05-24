# pi-stuff

Collection of stuff for pi.

## Setup

```bash
git clone git@github.com:anandyandawang/pi-stuff
cd pi-stuff
pnpm install        # installs deps for every extension in one shot
pi install "$PWD"   # or `pi install pi-stuff` from the parent dir
```

Build the **gondolin** VM image:
```bash
cd extensions/gondolin
npx gondolin build --config build-config.json --output ./assets
```

## Stuff

### Extensions
- **gondolin**: Sandbox tool calls in a micro-VM (JVM toolchain).
- **curious**: Makes pi ask more questions instead of guessing.
- **grug**: Grug brain for pi.

### Skills
- **web-search**: Let pi search the web via DuckDuckGo.
