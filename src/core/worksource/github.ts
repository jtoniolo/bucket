/**
 * GitHub Issues Work Source — the v1 default adapter.
 *
 * The Engine stays source-agnostic: it only ever runs the opaque command
 * strings in `ResolvedConfig.workSource`. This module supplies the defaults for
 * those strings, wired to the `gh` CLI. Each command emits/consumes the Engine's
 * contract shape, so the orchestrator never parses GitHub-specific JSON:
 *
 *   - list  → JSON array of `{ id, title, labels }`         (ready Tasks)
 *   - view  → JSON object `{ id, title, body }`             (one Task's full body)
 *   - close → closes the Issue with a completion comment    (no stdout contract)
 *
 * A Preset may override any of these (e.g. the aquarify preset drives a GitHub
 * Projects board instead) without touching the Engine.
 */

/** Label that marks an Issue as ready for an autonomous agent to pick up. */
export const READY_LABEL = "ready-for-agent";

/**
 * `list`: emit open, ready-for-agent Issues as the contract Task array.
 * `--jq` reshapes `gh`'s output into `{ id, title, labels }`.
 */
export const GITHUB_LIST =
  `gh issue list --state open --label ${READY_LABEL} ` +
  `--json number,title,labels ` +
  `--jq 'map({id: .number, title: .title, labels: [.labels[].name]})'`;

/** `view {id}`: emit one Task's full body as `{ id, title, body }`. */
export const GITHUB_VIEW =
  `gh issue view {id} --json number,title,body ` +
  `--jq '{id: .number, title: .title, body: .body}'`;

/** `close {id}`: mark the Task done with a completion comment. No push. */
export const GITHUB_CLOSE = `gh issue close {id} --comment "Completed by Bucket."`;

/** `start {id}`: mark a Task as in-progress before implementation begins. */
export const GITHUB_START = `gh issue edit {id} --add-label in-progress`;

export const GITHUB_WORK_SOURCE = {
  list: GITHUB_LIST,
  view: GITHUB_VIEW,
  close: GITHUB_CLOSE,
  start: GITHUB_START,
} as const;
