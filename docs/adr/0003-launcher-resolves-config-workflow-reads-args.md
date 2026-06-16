# Launcher resolves config; the Workflow reads only `args`

Bucket's orchestrator is a Claude Code Workflow script (ADR-0001). Workflow scripts run in a restricted sandbox: **no filesystem access** and no `Date.now()`/`Math.random()`. The orchestrator therefore cannot read a config file itself.

We split responsibilities accordingly:

- The **`/bucket` slash command (the Launcher)** is a prompt. It reads `bucket.config.json`, resolves the active Preset, and invokes the `Workflow` tool, passing the fully-resolved config in as `args`.
- The **Workflow script** reads everything from `args` (Base Branch, the three Work Source Commands, Parallelism Cap, branch-name format, test/lint commands, per-phase models). Phase prompts are embedded in the script as strings.

Config format is plain **JSON** so the Launcher needs zero parsing dependencies.

## Consequences

- Invoking `/bucket` is also the user opt-in the Workflow tool requires before spawning agents — a single, intentional entry point.
- Any value the orchestrator needs must travel through `args`; nothing is read lazily mid-run. This keeps each run's inputs explicit and is compatible with the Workflow tool's deterministic resume (same args → cached results).
- The strip line is clean: deleting a Preset directory and removing its name from `bucket.config.json` removes all repo-specific behavior without touching the Engine, the Launcher, or the Workflow script.
