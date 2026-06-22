# Bucket

A native Claude Code plugin that reproduces the overall process of [Sandcastle](https://github.com/mattpocock/sandcastle): an autonomous loop that plans, implements, reviews, and merges Tasks using isolated agents. Where Sandcastle uses an external TypeScript orchestrator and Docker sandboxes, Bucket uses Claude Code's native primitives (a Workflow script, sub-agents, git worktrees).

The name is a nod to Sandcastle — you build a sandcastle with a bucket — and to how it works: it scoops from a bucket of ready Tasks.

## Language

**Engine**:
The repo-agnostic core of the plugin — the Workflow orchestration script and phase prompts that work against any repo and any Work Source. Contains no aquarify-specific values.
_Avoid_: core, framework, runtime

**Launcher**:
The `/bucket:run` slash command. It reads `.bucket/config.json`, resolves the active Preset, and starts the Workflow with the resolved config passed as `args`. It is the single entry point and the user opt-in the Workflow tool requires.
_Avoid_: entrypoint, trigger, runner

**Preset**:
A cleanly-detachable bundle of configuration that adapts the Engine to one specific repo (the Work Source commands, branch naming, base branch, test/lint commands, project rules). The aquarify preset is the reference preset and MUST be strippable before publishing without touching the Engine.
_Avoid_: config, profile, plugin-config

**Task**:
The unit of work the loop picks up, implements, and completes. Source-neutral — a Task may be realized as a GitHub Issue, a Beads item, a markdown file, etc.
_Avoid_: ticket, story, work item

**Issue**:
The GitHub realization of a Task. Use "Issue" only when specifically referring to GitHub Issues; otherwise say "Task".

**Work Source**:
Where Tasks come from. The Engine never talks to a source directly; it is abstracted behind the Work Source Commands, which a Preset supplies. The basics target plain GitHub Issues; the aquarify preset overrides them to read/write a GitHub Projects board.
_Avoid_: backend, provider, tracker

**Work Source Commands**:
The four shell commands that form the contract between the Engine and a Work Source: **list** (emit ready-for-work Tasks as JSON — the sole source of truth for what work exists), **view** (read one Task's full body), **close** (mark one Task done, or transition its status), and **start** (mark one Task as in-progress before implementation begins). Each command that targets a single Task carries an `{id}` placeholder.

## The Loop

The product is a four-phase loop. Each named phase below is the canonical term for that step.

**Loop**:
The repeated execution of Plan → Execute → Review → Merge. One iteration is a **Pass**. The Loop runs until the Unblocked Set is empty or Max Passes is reached. It deliberately keeps running even when a Pass merges nothing, because Resumption is how stuck Tasks eventually get unstuck (see ADR-0004).
_Avoid_: cycle, round

**Pass**:
A single iteration of the Loop (one Plan → Execute → Review → Merge).
_Avoid_: iteration, cycle, round

**Max Passes**:
The bounded number of Passes a Loop will run before stopping (configurable). The only hard stop besides an empty Unblocked Set.
_Avoid_: max iterations, timeout

**Plan**:
The first phase. Reads the Work Source's ready Tasks, builds a dependency graph, and selects the Unblocked Set to work this pass. Produces a structured plan.
_Avoid_: schedule, triage

**Blocker**:
A Task whose work must be merged into the Base Branch before another Task can safely start — because the other Task needs its code/infrastructure, depends on an API shape it establishes, or would conflict on overlapping files.
_Avoid_: dependency, prerequisite

**Unblocked Set**:
The Tasks selected in one Plan pass: those with zero unresolved Blockers, ordered by policy, then truncated to the Parallelism Cap.
_Avoid_: batch, queue, ready set

**Parallelism Cap**:
The maximum number of Tasks worked in a single pass (default 3, configurable). Bounded deliberately below the machine's agent-concurrency limit because each Task's test+lint runs saturate CPU/IO long before the agent count does.
_Avoid_: concurrency limit, batch size

**Execute**:
The second phase. For each planned Task, an implementer agent does the work on the Task's own branch in its own worktree. Tasks in the set run in parallel.
_Avoid_: implement-phase, build, run

**Review**:
The third phase. For each branch that produced commits, a reviewer agent improves clarity/correctness on that same branch/worktree before merge.
_Avoid_: QA, audit

**Merge**:
The fourth phase. Folds the completed branches into the Base Branch, resolving conflicts and verifying, then reports Task completion back to the Work Source.
_Avoid_: integrate, land

**Base Branch**:
The branch the Loop merges completed work into and plans the next pass from (Sandcastle's `dev`). Configured per Preset.
_Avoid_: main, trunk, target branch

**Commits-Ahead-of-Base**:
The structural test for whether a Task produced work: the count of commits on its branch not yet in the Base Branch. The product trusts this, never an agent's self-reported "done". A branch with commits is eligible for Review/Merge; zero commits means nothing happened.
_Avoid_: success flag, completion signal

**Resumption**:
Re-entering a Task whose branch already has unmerged commits (Commits-Ahead-of-Base > 0) and continuing from the existing work rather than starting fresh. Enabled by deterministic per-Task branch names and prioritized ahead of new work in the next Plan pass.
_Avoid_: retry, restart, recovery

**Commit Prefix**:
The configurable marker prepended to every autonomous commit message (default `RALPH:`). Functional, not decorative: phase prompts grep it (`git log --grep`) to show the agent its own recent autonomous commits.
_Avoid_: tag, label
