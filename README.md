# Bucket

A native [Claude Code](https://claude.com/claude-code) plugin that runs an autonomous, multi-agent development loop over a backlog of tasks — planning, implementing, reviewing, and merging work on its own, in isolated git worktrees.

Bucket reproduces the overall process of [Sandcastle](https://github.com/mattpocock/sandcastle) using Claude Code's own primitives instead of an external orchestrator and Docker sandboxes. The name is a nod to Sandcastle — you build a sandcastle with a bucket — and to how it works: it scoops from a bucket of ready tasks.

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

## Installation

**Prerequisites:** Claude Code, Node.js 18+, `git`, and `gh` (GitHub CLI, authenticated).

### 1. Install the plugin

From the directory where Claude Code is running:

```sh
claude plugin install https://github.com/jtoniolo/bucket
```

Or, to install from a local clone:

```sh
git clone https://github.com/jtoniolo/bucket
claude plugin install ./bucket
```

### 2. Build the plugin (first use or after updates)

```sh
cd bucket        # or wherever the plugin is installed
npm install
npm run build
```

This produces `dist/bucket.workflow.js` (the Workflow the Launcher invokes) and `dist/resolve-config.mjs` (the config resolver the Launcher runs before starting).

### 3. Add a config to your repo

Create `bucket.config.json` at the root of the repo you want Bucket to work on. Minimal config for a GitHub Issues work source:

```json
{
  "baseBranch": "main",
  "test": "npm test",
  "lint": "npm run typecheck"
}
```

See [Configuration](#configuration) below for all options.

### 4. Run Bucket

Open Claude Code in your repo, then invoke the slash command:

```
/bucket:run
```

That's the explicit opt-in. Bucket reads and validates your config, then starts the autonomous loop.

## Architecture

| Piece | Role |
| --- | --- |
| **Launcher** | The `/bucket:run` slash command. Reads config, resolves the active preset, and starts the workflow. Invoking it is your explicit opt-in to the run. |
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
# inside the box: install Claude Code + your toolchain, clone the repo, run /bucket:run
```

**Docker** (stronger isolation; mount only the repo):

```sh
docker run -it --rm \
  -v "$PWD":/work -w /work \
  node:22-bookworm bash
# inside the container: install Claude Code + your toolchain, then run /bucket:run
```

In both cases, give the environment only the credentials and network access the run genuinely needs. See [ADR-0002](./docs/adr/0002-worktree-isolation-not-a-security-sandbox.md) for the full safety model.

## Configuration

All settings live in `bucket.config.json` at your repo root. Every field is optional — Bucket's engine defaults are sane for a standard GitHub Issues + `main` branch setup.

```json
{
  "preset": null,
  "baseBranch": "main",
  "branchPrefix": "ralph",
  "branchFormat": "{prefix}/issue-{id}",
  "commitPrefix": "RALPH:",
  "maxPasses": 10,
  "parallelismCap": 3,
  "test": "npm test",
  "lint": "npm run typecheck",
  "workSource": {
    "list": "gh issue list --label ready-for-agent --json number,title,body,labels --jq '[.[] | {id: .number, title: .title, body: .body, labels: [.labels[].name]}]'",
    "view": "gh issue view {id} --json number,title,body --jq '{id: .number, title: .title, body: .body}'",
    "close": "gh issue close {id} --comment 'Closed by Bucket.'"
  },
  "phases": {
    "plan":    { "model": "opus",   "effort": "high"   },
    "execute": { "model": "sonnet", "effort": "medium" },
    "review":  { "model": "sonnet", "effort": "medium" },
    "merge":   { "model": "sonnet", "effort": "medium" }
  }
}
```

### Field reference

| Field | Default | Description |
| --- | --- | --- |
| `preset` | `null` | Name of an active Preset directory under `presets/`. `null` means no preset. |
| `baseBranch` | `"main"` | The branch Bucket merges completed work into. |
| `branchPrefix` | `"ralph"` | Prefix segment of the per-task branch name (the `{prefix}` token in `branchFormat`). |
| `branchFormat` | `"{prefix}/issue-{id}"` | Branch name template. Must contain `{id}`. `{prefix}` is expanded from `branchPrefix`. |
| `commitPrefix` | `"RALPH:"` | Every autonomous commit starts with this string. The prompts also grep it to surface recent agent commits. |
| `maxPasses` | `10` | Maximum number of Plan→Execute→Review→Merge passes before the loop stops. |
| `parallelismCap` | `3` | Maximum number of tasks worked in parallel each pass. |
| `test` | `""` | Shell command that runs tests. Run by implementer agents after each change. Empty string skips. |
| `lint` | `""` | Shell command that runs linters/type-checkers. Run alongside tests. Empty string skips. |
| `workSource.list` | *(GitHub Issues)* | Shell command that emits ready Tasks as a JSON array `[{id, title, body, labels}]`. This is the **sole source of truth** for what work is ready. |
| `workSource.view` | *(GitHub Issues)* | Shell command that emits one Task's full body. Must contain `{id}`. |
| `workSource.close` | *(GitHub Issues)* | Shell command that marks one Task done. Must contain `{id}`. |
| `phases.plan.model` | `"opus"` | Claude model for the Plan phase. `"opus"` recommended (deeper reasoning for dependency graphs). |
| `phases.plan.effort` | `"high"` | Effort level for the Plan phase agent. |
| `phases.execute.model` | `"sonnet"` | Claude model for implementer agents in the Execute phase. |
| `phases.execute.effort` | `"medium"` | Effort level for implementer agents. |
| `phases.review.model` | `"sonnet"` | Claude model for reviewer agents in the Review phase. |
| `phases.review.effort` | `"medium"` | Effort level for reviewer agents. |
| `phases.merge.model` | `"sonnet"` | Claude model for the merge agent. |
| `phases.merge.effort` | `"medium"` | Effort level for the merge agent. |

### Presets

A Preset is a self-contained directory that overrides Engine defaults for one repo. Create `presets/<name>/preset.config.json` and set `"preset": "<name>"` in `bucket.config.json`. Any field in `preset.config.json` wins over the engine default but loses to `bucket.config.json`.

Presets keep repo-specific values (custom work-source commands, project-specific branch conventions, adjusted phase models) out of the shared Engine. Stripping a private preset before publishing is a matter of deleting its directory.

## Progress output

Bucket emits structured progress as it runs:

- **Pass banner** — `─── Bucket Pass N/M starting ───` at the start of each pass.
- **Phase announcements** — `Plan (Pass N/M)`, `Execute (Pass N/M)`, `Review (Pass N/M)`, `Merge (Pass N/M)` as each phase begins.
- **Per-task logs** — task ID, branch, and outcome for every task in every phase.
- **Pass summary** — merged and skipped counts after the Merge phase completes.
- **Final summary** — `═══ Bucket done — N pass(es), N task(s) merged ═══` on exit with the stop reason (`empty-unblocked-set` or `max-passes`).

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
- `commands/run.md` + `.claude-plugin/plugin.json` — the `/bucket:run` slash command and plugin manifest.
- `bucket.config.json` — the single declarative config the Launcher reads.

## Documentation

- [`CONTEXT.md`](./CONTEXT.md) — the project glossary; the canonical vocabulary for everything above.
- [`docs/adr/`](./docs/adr/) — architecture decision records.

## Credits

Bucket is a native-Claude-Code reimagining of [Sandcastle](https://github.com/mattpocock/sandcastle) by [Matt Pocock](https://github.com/mattpocock). It aims to reproduce the *overall process*, not to be a drop-in port — a 100% behavioral match is an explicit non-goal.
