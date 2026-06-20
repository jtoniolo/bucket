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
  /**
   * True when the Task's branch already has unmerged commits (Commits-Ahead-of-Base > 0)
   * from a previous Pass. The Execute phase reads this to continue from existing
   * work rather than starting fresh.
   */
  resuming?: boolean;
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

/**
 * Assign a numeric rank for the ordering policy: bug → tracer → polish → refactor → other.
 * Lower rank = higher priority.
 */
function taskPriority(task: Task): number {
  for (const label of task.labels) {
    const l = label.toLowerCase();
    if (l === "bug" || l.startsWith("bug") || l.endsWith("bug") || l.includes("bug")) return 0;
    if (l.includes("tracer")) return 1;
    if (l.includes("polish")) return 2;
    if (l.includes("refactor")) return 3;
  }
  return 4;
}

/**
 * Select up to `cap` Tasks for a single Pass, ordered by the policy:
 *   bug fixes (0) → tracer bullets (1) → polish (2) → refactors (3) → other (4)
 *
 * Within the same priority tier, Tasks are ordered by id ascending (oldest first)
 * to keep selection deterministic across runs.
 *
 * Slice 2: replaces the single-Task `selectHighestPriority` with multi-Task
 * parallel selection bounded by the Parallelism Cap.
 */
export function selectTasks(tasks: Task[], cap: number): Task[] {
  if (tasks.length === 0) return [];
  const sorted = [...tasks].sort((a, b) => {
    const pa = taskPriority(a);
    const pb = taskPriority(b);
    if (pa !== pb) return pa - pb;
    return a.id - b.id; // stable tie-break: lowest id first
  });
  return sorted.slice(0, cap);
}
