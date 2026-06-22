# TASK

Implement Task #{{TASK_ID}}: {{TASK_TITLE}}

Read the full Task body:

```
{{VIEW_COMMAND}}
```

If the Task references a parent specification, read that too.

Work ONLY on this single Task. Do NOT work on any other Task.

## Mark in progress

Before doing any other work, mark the Task as started:

```
{{START_COMMAND}}
```

## Code quality

You MUST follow every rule, convention, and constraint defined in this repository. Read the project's documentation and configuration files before writing any code.

There are NO pre-existing test failures or lint errors. If tests or lint fail on your branch, YOU own the failure — fix it.

{{PLANNER_CONTEXT}}

## Resume check

Before starting work, check if your branch already has commits ahead of the base:

```
git log --oneline {{BASE_BRANCH}}..HEAD
```

If there are existing commits, you are **resuming** a previous attempt that may have failed or timed out. Read the existing code and tests, assess what is already done versus what remains, and continue from there. Do NOT redo completed work.

If there are no commits, this is a fresh start.

## Exploration

Explore the repository to understand the codebase. Read files, tests, and documentation relevant to this Task. Fill your context with enough information to implement the change correctly.

## Execution — TDD is mandatory

You MUST use Red-Green-Refactor (TDD) for all implementation work:

1. **RED**: Write one failing test that specifies the next piece of behaviour.
2. **GREEN**: Write the minimum implementation to make that test pass.
3. **REPEAT** steps 1–2 until the Task is fully implemented.
4. **REFACTOR**: Clean up the code while keeping all tests green.

## Feedback loops

{{TEST_STEP}}{{LINT_STEP}}Fix every failure before committing. You MUST NOT skip or bypass any pre-commit hooks.

## Commit

Make a git commit. The commit message MUST:

1. Start with the `{{COMMIT_PREFIX}}` prefix
2. Summarise the Task completed
3. Note key decisions made
4. List files changed

Keep it concise.

Do NOT close the Task — that happens in the Merge phase.

## Output

Return a JSON object matching this schema:

```json
{
  "committed": true,
  "summary": "One-line summary of what was done"
}
```

Fields:

- `committed` (boolean, required): Whether at least one commit was made on the branch.
- `summary` (string): One-line summary of what was done.

## Safety rails

- Work on a SINGLE Task only.
- Do NOT create pull requests. Do NOT run `gh pr create`. Do NOT push to remote.
