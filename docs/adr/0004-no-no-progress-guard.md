# No no-progress guard — Passes run to the bound; Resumption is the recovery path

The Loop stops on exactly two conditions: an empty Unblocked Set, or reaching Max Passes. It deliberately does **not** stop when a Pass merges zero new work.

The obvious-looking optimization — "if a Pass made no progress, bail out" — would break the core persistence model. Agents routinely fail to commit on a given Pass because they bit off too much at once, or left lint/test errors they couldn't clear within their iteration budget, or timed out. That is not a signal to give up; it is the exact situation Resumption exists for. The next Pass recreates a worktree from the branch's partial commits and continues, often succeeding where the previous Pass ran out of budget.

A no-progress guard would kill the Loop precisely when a hard Task is mid-grind, defeating the whole RALPH-style "keep going until done" behavior that motivates the product.

## Consequences

- A genuinely stuck Task can consume Passes without completing; Max Passes is the backstop, not a progress heuristic.
- A future reader will likely see the Loop re-planning after a zero-merge Pass and assume it is a bug. It is not — do not add a no-progress guard.
