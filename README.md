# pi-stuff

Collection of stuff for pi.

## Setup

```bash
git clone https://github.com/anandyandawang/pi-stuff.git
cd pi-stuff
pnpm install
pi install .
```

Build the **gondolin** VM image:
```bash
cd extensions/gondolin
npx gondolin build --config build-config.json --output ./assets
```

Installation complete. Now go to your project and run `pi`:
```bash
cd ../.. # back to pi-stuff root, or your project of choice
pi
```

## Stuff

### Extensions
- **gondolin**: Sandbox tool calls in a micro-VM (JVM toolchain).
- **curious**: Makes pi ask more questions instead of guessing.
- **grug**: Grug brain for pi.

### Skills
- **web-search**: Let pi search the web via DuckDuckGo.
