# Workflow-script orchestration instead of headless `claude -p`

Sandcastle drives its loop with an external TypeScript orchestrator (`main.mts`) that runs Claude Code agents headlessly via `claude -p`. We are instead implementing the orchestrator as a Claude Code **Workflow script** launched from a plugin command inside an interactive Claude Code session.

Why: Anthropic is moving headless `claude -p` onto API-credit billing, so a faithful port of `main.mts` would consume API credits. A Workflow script runs against the user's Claude Code subscription instead. It also keeps control flow deterministic (phase sequencing, the unblocked-issue cap, the outer loop, and merge-gating are real JS, not model judgment) and gives per-agent git-worktree isolation natively — matching Sandcastle's determinism without its Docker sandboxes.

## Considered Options

- **Headless `claude -p` in a script** (faithful port) — rejected: bills API credits; not a native plugin.
- **Skill-driven, main-agent-as-orchestrator** — rejected: the orchestrator itself becomes an LLM, giving away the deterministic control flow we are trying to preserve.
- **Workflow script** (chosen) — deterministic JS control flow, subscription billing, native worktree fan-out, packageable as a plugin.

## Consequences

- The plugin ships a command that launches the Workflow; that command is also what satisfies the Workflow tool's required user opt-in (acceptable, and desirable for a "safe" autonomous tool).
- We cannot achieve a 100% behavioural match with Sandcastle, which is an accepted non-goal.
