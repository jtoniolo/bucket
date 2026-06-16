/**
 * Task parsing and slice-1 selection.
 *
 * The Work Source `list` command is the sole source of truth for what work
 * exists (CONTEXT.md / PRD user-story 8). Its stdout is a JSON array of Tasks
 * in the Engine's contract shape; a Preset's adapter is responsible for
 * normalising its source's output into that shape via `--jq` or similar.
 */

export interface Task {
  /** Stable identifier (GitHub Issue number in the v1 Work Source). */
  id: number;
  title: string;
  labels: string[];
}

/**
 * Parse the JSON stdout of a Work Source `list` command into Tasks.
 *
 * @throws with a clear message if the payload is not a well-formed Task array.
 */
export function parseTasks(json: string): Task[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `parseTasks: work source 'list' did not return valid JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new Error("parseTasks: work source 'list' must return a JSON array of Tasks");
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`parseTasks: Task at index ${i} is not an object`);
    }
    const t = entry as Record<string, unknown>;
    if (typeof t.id !== "number") {
      throw new Error(`parseTasks: Task at index ${i} is missing a numeric "id"`);
    }
    if (typeof t.title !== "string") {
      throw new Error(`parseTasks: Task ${String(t.id)} is missing a string "title"`);
    }
    const labels = Array.isArray(t.labels) ? t.labels.filter((l): l is string => typeof l === "string") : [];
    return { id: t.id, title: t.title, labels };
  });
}

/**
 * Select the single highest-priority ready Task.
 *
 * Slice 1 of the walking skeleton has no Plan dependency graph and no ordering
 * policy yet (those arrive with `selectPlan` in a later slice). The deterministic
 * stand-in is "oldest ready first" — the lowest Task id — which is stable across
 * runs. Returns null when nothing is ready.
 */
export function selectHighestPriority(tasks: Task[]): Task | null {
  if (tasks.length === 0) return null;
  return tasks.reduce((best, t) => (t.id < best.id ? t : best));
}
