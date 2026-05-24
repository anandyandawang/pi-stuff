# pi-stuff

Collection of stuff for pi.

## Setup

```bash
git clone git@github.com:anandyandawang/pi-stuff
pi install pi-stuff
```

If you use **gondolin**, you must build the VM image once:
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
