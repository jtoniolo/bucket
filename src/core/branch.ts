/**
 * Deterministic per-Task branch naming.
 *
 * `branchFor` is one of the tested seams from ADR-0005: given a Task and a
 * resolved branch-format template, it always produces the same branch name.
 * Determinism here is what makes Resumption possible — re-planning the same
 * Task lands on the same branch, so accumulated commits are preserved.
 */

export interface TaskRef {
  /** The Task's identifier (a GitHub Issue number in the v1 Work Source). */
  id: number | string;
}

/**
 * Build the branch name for a Task from a format template.
 *
 * The template must contain the `{id}` placeholder. The Engine default
 * (after Preset/prefix resolution) is `ralph/issue-{id}`.
 *
 * @throws if the format is missing `{id}` or the Task has no usable id.
 */
export function branchFor(task: TaskRef, format: string): string {
  if (typeof format !== "string" || format.length === 0) {
    throw new Error("branchFor: branch format must be a non-empty string");
  }
  if (!format.includes("{id}")) {
    throw new Error(
      `branchFor: branch format must contain the "{id}" placeholder (got "${format}")`,
    );
  }
  if (task == null || task.id === undefined || task.id === null || task.id === "") {
    throw new Error("branchFor: task is missing an id");
  }
  return format.replaceAll("{id}", String(task.id));
}
