# pr-reviewer

Pi extension. Polls own GitHub PRs at interval. For each new (PR, head SHA),
fans out reviews across N user-chosen models in parallel — one `pi` child
process per model. Aggregated review lands in TUI as steer message and (unless
`--dry-run`) on GitHub as a PR comment.

Subagent count = model count. Each subagent runs:
`pi -p <prompt> --mode json --model <id> --no-extensions --no-tools`.

## Requirements

- `gh` CLI on PATH, authenticated (`gh auth status`).
- `pi` on PATH (the subagents call it).

## Slash command

```
/pr-review start --models <m1,m2,...> --interval <Ns|Nm|Nh> [--dry-run] [--include-drafts]
/pr-review stop
/pr-review status
/pr-review now
/pr-review reset
```

Examples:

```
/pr-review start --models claude-opus-4-7,claude-sonnet-4-6 --interval 5m
/pr-review start --models gpt-5,claude-sonnet-4-6 --interval 30s --dry-run
/pr-review now
/pr-review stop
```

## Behavior

- PR scope: `gh search prs --author=@me --state=open`. Drafts skipped unless `--include-drafts`.
- Dedupe key: `<pr-url>@<headRefOid>`. Pushing a new commit re-triggers review.
- State persisted via `pi.appendEntry` — config, seen set, and running flag survive `/new` and process restart. Last running session auto-resumes on next `session_start`.
- Per-subagent cap: 50 KB stdout, 5 min timeout.
- If all subagents fail for a PR, no GitHub comment is posted.

## Caveats

- `gh search prs` doesn't return `headRefOid` / `isDraft`. Each candidate gets a follow-up `gh pr view --json headRefOid,isDraft`. With 50 PRs this is 51 `gh` calls per cycle — pick an interval that respects rate limits.
- Spawning `pi` recursively requires `--no-extensions` (avoids re-loading this extension in the subagent and recursing).
- Subagents pass `--no-tools` — they get the diff inline and can't shell out. Drop this in `reviewer.ts` if you want the subagent to read the repo.
