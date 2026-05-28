# deploy-watch

Pi extension. Babysit deployments hands-free.

- Background poll merged PRs in configured GitHub repos.
- Track GitHub Actions workflow runs for each merge through to conclusion.
- Concurrently run Datadog [`pup`](https://github.com/DataDog/pup) CLI commands during the deploy window.
- Hand combined GitHub + Datadog data to the agent via steer message; agent judge anomaly. No auto-rollback.

## Setup

```bash
pnpm install        # at repo root
pup auth login      # one-time browser OAuth (preferred)
# or export DD_API_KEY + DD_APP_KEY for headless boxes
pi install ./extensions/deploy-watch
```

## Config (env vars)

| Var | Required | Default | Notes |
|---|---|---|---|
| `GITHUB_TOKEN` | yes | — | PAT with `repo` + `actions:read` (classic) or `pull-requests:read` + `actions:read` (fine-grained) |
| `DEPLOY_WATCH_REPOS` | yes | — | CSV `owner/repo,owner/repo` |
| `DEPLOY_WATCH_PUP_COMMANDS` | no | `[]` | JSON `string[][]`, e.g. `[["monitors","list","--output","json","--tag","service:foo"]]` |
| `DEPLOY_WATCH_POLL_MS` | no | `60000` | PR-list poll interval |
| `DEPLOY_WATCH_RUN_POLL_MS` | no | `30000` | Per-workflow-run poll interval |
| `DEPLOY_WATCH_SOAK_MS` | no | `300000` | Wait after last run terminal before steer (let metrics settle) |
| `DEPLOY_WATCH_WORKFLOW_START_TIMEOUT_MS` | no | `600000` | Give up if no run for merge SHA in this window |
| `DEPLOY_WATCH_PUP_BIN` | no | `pup` | Absolute path if not on `PATH` |
| `DD_API_KEY` / `DD_APP_KEY` / `DD_SITE` | no | — | Only used by `pup` if no OAuth session |

## Slash commands

- `/deploy-watch status` — show running/paused, repos, seen PR count, active deploys, GH rate-limit.
- `/deploy-watch pause` — stop scheduling new tracks.
- `/deploy-watch resume` — resume polling.

## Tools

- `query_datadog({ command: string[] })` — run a pup subcommand on demand. Useful when the agent want to drill into a steer payload.

## Behavior notes

- Cold start: PRs merged before session start are ignored.
- Merge SHA: uses `pr.merge_commit_sha` when present, else `pr.head.sha`. Cover squash / rebase / merge-commit.
- Rate limit: backs off when GH `x-ratelimit-remaining` < 500.
- Pup auth: extension probes `pup auth status` once at startup if pup commands configured. Non-fatal warn on failure.
- Subprocess: pup invoked via `execFile` with array args — no shell, no injection.
- Steer payload capped at ~200 KB; per-pup-stdout capped at 50 KB.
