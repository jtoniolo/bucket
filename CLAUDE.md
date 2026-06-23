## Build

This is a Claude Code plugin. Do NOT touch `dist/` or run the build manually. Only edit source files under `src/`, `build/`, and `prompts/`.

The build (`build/bundle.mjs`) inlines two things into the workflow script via marker comments in `src/workflow/bucket.workflow.js`:

1. The deterministic core (`src/core/`) at `// __BUCKET_CORE_IIFE__`
2. Default prompts (`prompts/*.md`) at `// __BUCKET_PROMPTS__`

Both markers MUST have matching injection logic in `build/bundle.mjs`. If you add or remove a marker, update the build.

## Debugging

Start with `git diff`. Read source files, never dist — dist is generated. When a workflow crashes, the error is in the source or the build, not the Workflow runtime.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `jtoniolo/bucket` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
