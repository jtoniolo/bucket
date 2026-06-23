# TASK

Merge branch `{{BRANCH}}` (Task #{{TASK_ID}}) into `{{BASE_BRANCH}}`.

## Steps

1. Check out `{{BASE_BRANCH}}` and pull latest.
2. Run `git merge {{BRANCH}} --no-edit`.
3. If there are merge conflicts, resolve them by reading both sides and choosing the correct resolution.{{VERIFY_STEP}}

After a successful merge, close the Task:

```
{{CLOSE_COMMAND}}
```

## Output

Return a JSON object matching this schema:

```json
{
  "merged": true,
  "closed": true,
  "notes": "Any conflicts resolved or verification output worth noting"
}
```

Fields:

- `merged` (boolean, required): Whether the branch was merged into `{{BASE_BRANCH}}`.
- `closed` (boolean): Whether the Task was closed via the Work Source.
- `notes` (string): Any conflicts resolved or verification output worth noting.
