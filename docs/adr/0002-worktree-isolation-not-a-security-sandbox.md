# Worktree isolation is change-isolation, not a security sandbox

Sandcastle runs each agent inside a Docker container, giving OS-level isolation: a rogue or confused agent cannot touch the host, the real git remote, or anything outside the sandbox. This plugin runs agents natively in git worktrees instead (see ADR-0001), which is a deliberately weaker isolation model, and we are documenting the consequence explicitly so it is not misremembered as equivalent.

A git worktree isolates **changes** — each Task works in its own checkout, so parallel agents never clobber each other's files — but it does **not** isolate **blast radius**. Agents still run as the user, with full filesystem access, the user's credentials, network, and real git remotes. We accepted this trade-off to run on the Claude Code subscription natively rather than billing API credits for headless containerized runs.

## Safety model

"Safely," in this product, means operating within these architectural limits:

1. **Per-Task worktree isolation** — parallel agents never share a working tree.
2. **No outward mutation** — no `git push`, no `gh pr create`, no remote writes; work stays local until the user reviews.
3. **No bypassing repo gates** — no `--no-verify`, no force-push, no history rewrites (enforced via the `git-guardrails-claude-code` hook).
4. **Bounded blast radius** — bounded outer Loop, bounded concurrency, and the Workflow tool's required user opt-in to start.
5. **Not OS-level containment** — if true containment is required, run the entire Claude Code session inside an isolated environment (distrobox/Docker container/VM). That is the user's responsibility, not the plugin's.

## Consequences

- The README MUST clearly state the sandbox limitation and document how to run the whole process inside an isolated environment (distrobox or Docker container) for users who need real containment.
- The plugin does not attempt OS-level sandboxing itself; doing so would defeat the subscription-billing rationale of ADR-0001.
