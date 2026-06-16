# Bucket

A native [Claude Code](https://claude.com/claude-code) plugin that runs an autonomous, multi-agent development loop over a backlog of tasks — planning, implementing, reviewing, and merging work on its own, in isolated git worktrees.

Bucket reproduces the overall process of [Sandcastle](https://github.com/mattpocock/sandcastle) using Claude Code's own primitives instead of an external orchestrator and Docker sandboxes. The name is a nod to Sandcastle — you build a sandcastle with a bucket — and to how it works: it scoops from a bucket of ready tasks.

> **Status: walking skeleton.** The product is documented (see [`CONTEXT.md`](./CONTEXT.md) and [`docs/adr/`](./docs/adr/)). The first end-to-end slice is implemented: the `/bucket` Launcher resolves config and runs a Workflow that implements a single ready Task in an isolated worktree and merges it. The Plan dependency graph, Review, parallelism, and the outer Loop are not built yet.

## What it does

Bucket runs a four-phase loop and repeats it until the backlog is exhausted or a pass budget is reached:

1. **Plan** — read the ready tasks from your work source, build a dependency graph, and select the *unblocked set* to work this pass (capped, default 3).
2. **Execute** — spin up one implementer agent per task, each on its own branch in its own git worktree, running in parallel. Agents work test-first, run lint/tests, and commit locally.
3. **Review** — for each branch that produced commits, a reviewer agent cleans up clarity and correctness on the same branch.
4. **Merge** — fold the completed branches into the base branch, resolve conflicts, verify, and report completion back to the work source.

Each new pass re-plans, so tasks unblocked by the previous round's merges get picked up next. Work that didn't finish in one pass (an agent that timed out mid-task, say) is **resumed** from its existing commits on the next pass rather than restarted — the loop keeps grinding until the work is done.

## Why native Claude Code

Sandcastle drives its loop with an external TypeScript program that runs agents headlessly via `claude -p`. Bucket instead runs as a Claude Code **Workflow** launched from inside an interactive session, so it executes against your Claude Code subscription rather than billing API credits. You also get deterministic control flow (phase sequencing, the unblocked-set cap, the outer loop, and merge-gating are real code, not model judgment) and per-task git-worktree isolation for free.

See [ADR-0001](./docs/adr/0001-workflow-script-orchestration.md) for the full rationale.

## Architecture

| Piece | Role |
| --- | --- |
| **Launcher** | The `/bucket` slash command. Reads config, resolves the active preset, and starts the workflow. Invoking it is your explicit opt-in to the run. |
| **Engine** | The repo-agnostic core: the Workflow orchestration script and the four phase prompts. Knows nothing about any specific repo. |
| **Preset** | A cleanly-detachable bundle that adapts the Engine to one repo — its work-source commands, branch naming, base branch, test/lint commands, and project rules. |
| **Work Source** | Where tasks come from, abstracted behind three shell commands (*list* / *view* / *close*). The basics target plain GitHub Issues; a preset can override these to drive a GitHub Projects board, Beads, local files, etc. |

Configuration is a single declarative `bucket.config.json` (read by the Launcher and passed to the workflow as arguments — Workflow scripts can't read the filesystem themselves; see [ADR-0003](./docs/adr/0003-launcher-resolves-config-workflow-reads-args.md)). Presets live in self-contained directories, so adapting Bucket to a new repo — or stripping a private preset before publishing — is a matter of adding or deleting one directory.

## Safety and isolation

**Read this before running Bucket unattended.**

Bucket runs its agents in **git worktrees, not containers.** A worktree isolates *changes* — parallel agents each work in their own checkout and never clobber each other's files — but it does **not** isolate *blast radius*. Agents run as you, with your full filesystem access, your credentials, your network, and your real git remotes. **Worktrees are not a security sandbox.**

Within those limits, Bucket constrains itself by design:

- **Per-task worktree isolation** — parallel agents never share a working tree.
- **No outward mutation** — no `git push`, no `gh pr create`, no remote writes. Work stays local until you review it.
- **No bypassing repo gates** — no `--no-verify`, no force-push, no history rewrites.
- **Bounded blast radius** — a bounded outer loop, a bounded parallelism cap, and a required opt-in to start.

If you need true containment — for example, running Bucket against an untrusted backlog or fully unattended — **run the entire Claude Code session inside an isolated environment.** Two options:

**Distrobox** (lightweight, shares your home by default — scope it down):

```sh
distrobox create --name bucket-sandbox --image fedora:latest
distrobox enter bucket-sandbox
# inside the box: install Claude Code + your toolchain, clone the repo, run /bucket
```

**Docker** (stronger isolation; mount only the repo):

```sh
docker run -it --rm \
  -v "$PWD":/work -w /work \
  node:22-bookworm bash
# inside the container: install Claude Code + your toolchain, then run /bucket
```

In both cases, give the environment only the credentials and network access the run genuinely needs. See [ADR-0002](./docs/adr/0002-worktree-isolation-not-a-security-sandbox.md) for the full safety model.

## Configuration (planned)

A single `bucket.config.json` at the repo root holds the engine settings and names the active preset — base branch, the three work-source commands, parallelism cap, branch-name format, test/lint commands, per-phase models, and the commit-message prefix (default `RALPH:`, which the prompts grep to surface recent autonomous commits). The exact schema is not yet finalized.

## Development

The deterministic decision logic (config resolution, branch naming, the merge gate, Task selection) lives in a plain, tested core under `src/core/`. The Workflow sandbox can't read files or import at runtime, so a build step inlines that core into a single self-contained Workflow script ([ADR-0005](./docs/adr/0005-testable-core-bundled-into-workflow.md)).

```sh
npm install
npm test          # vitest: unit tests + a temp-git-repo integration test
npm run typecheck # tsc --noEmit
npm run build     # bundle dist/bucket.workflow.js + dist/resolve-config.mjs
```

- `src/core/` — pure, tested seams (`resolveConfig`, `branchFor`, `parseTasks`, work-source commands) plus the impure, integration-tested git wrapper.
- `src/workflow/bucket.workflow.js` — the thin orchestration shell (bundle source).
- `src/cli/resolve-config.ts` — the Launcher's config resolver/validator.
- `commands/bucket.md` + `.claude-plugin/plugin.json` — the `/bucket` slash command and plugin manifest.
- `bucket.config.json` — the single declarative config the Launcher reads.

## Documentation

- [`CONTEXT.md`](./CONTEXT.md) — the project glossary; the canonical vocabulary for everything above.
- [`docs/adr/`](./docs/adr/) — architecture decision records.

## Credits

Bucket is a native-Claude-Code reimagining of [Sandcastle](https://github.com/mattpocock/sandcastle) by [Matt Pocock](https://github.com/mattpocock). It aims to reproduce the *overall process*, not to be a drop-in port — a 100% behavioral match is an explicit non-goal.
