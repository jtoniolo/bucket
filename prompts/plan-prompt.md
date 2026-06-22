# TASK

You are the Planner. Fetch the list of ready Tasks from the Work Source and select which ones to work this pass.

## Fetch ready Tasks

Run this command to get the current list of ready Tasks:

```
{{LIST_COMMAND}}
```

Use `{{VIEW_COMMAND_TEMPLATE}}` (replacing `{id}` with the Task identifier) to read the full body of any Task you need more context on.

## Build a dependency graph

For each Task, determine whether it **blocks** or **is blocked by** any other Task.

A Task B is **blocked by** Task A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

A Task is **unblocked** if it has zero unresolved Blockers among the remaining ready Tasks.

## Detect resumption

Check for branches from previous passes:

```
git branch -a | grep "{{BRANCH_PREFIX}}"
```

For each matching branch, check commits ahead of base:

```
git log --oneline {{BASE_BRANCH}}..<branch-name>
```

- **If the branch has commits ahead of `{{BASE_BRANCH}}`** — the Task needs resumption. Include it in your plan with a `context` field describing the state (e.g. "Resuming — branch has N commits from a previous pass, check existing work before starting fresh").
- **If the branch has zero commits** — treat as a fresh start.

## Resolving Blockers

A Blocker is **resolved** if its work has been merged into `{{BASE_BRANCH}}`. Before declaring a Task blocked, verify whether the Blocker's branch was merged:

```
git log --oneline {{BASE_BRANCH}} | grep -i "<blocker-slug>"
```

If the branch appears in `{{BASE_BRANCH}}` history, the Blocker is resolved — treat the downstream Task as unblocked.

You MUST verify that Blockers are merged into `{{BASE_BRANCH}}` before declaring a Task blocked. If a Blocker is NOT merged, the blocking Task MUST be re-executed before downstream work can begin.

## Priority order

Select unblocked Tasks using this ordering:

1. **Resumptions first** — Tasks with existing branches that need completion take priority.
2. **Priority field** — higher priority Tasks first (if the Work Source provides priority).
3. **Work type** as a tiebreaker:
   1. Bug fixes — broken behaviour affecting users
   2. Tracer bullets — thin end-to-end slices that prove an approach works
   3. Polish — improving existing functionality
   4. Refactors — internal cleanups with no user-visible change

Select at most **{{PARALLELISM_CAP}}** Tasks.

# OUTPUT

Return your plan as a JSON object matching this schema:

```json
{
  "tasks": [
    {
      "id": 42,
      "title": "Fix auth bug",
      "context": "Optional notes for the implementer"
    }
  ]
}
```

Fields:

- `id` (integer, required): Task identifier (e.g. GitHub Issue number).
- `title` (string, required): Task title.
- `context` (string, optional): Situational notes for the implementer — resumption state, special instructions, known issues from previous attempts. Omit for fresh starts with no special context.

Include only unblocked Tasks, up to **{{PARALLELISM_CAP}}**. If every Task is blocked, return an empty `tasks` array.
