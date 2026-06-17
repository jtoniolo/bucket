/**
 * selectPlan — the deterministic core of the Plan phase.
 *
 * Given a list of ready Tasks (each annotated with their `blockedBy` edges)
 * and the set of Task IDs already merged into the Base Branch (`resolvedIds`),
 * returns a structured Plan containing only the Unblocked Set — Tasks with
 * zero unresolved Blockers — ordered by priority policy and truncated to the
 * Parallelism Cap.
 *
 * This is a pure function: no I/O, no side effects. The Plan agent / Workflow
 * is responsible for populating `blockedBy` (by reading each Task's body) and
 * determining which IDs are resolved (merged into the Base Branch).
 */

import type { Task } from "./task.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Task annotated with its dependency edges, as emitted by the Plan agent
 * after consulting the Work Source `view` command for each ready Task.
 */
export interface TaskWithBlockers extends Task {
  /**
   * IDs of Tasks whose code/infrastructure must be merged into the Base Branch
   * before this Task can safely start.
   */
  blockedBy: number[];
}

/**
 * One node in the blocks / blocked-by dependency graph.
 */
export interface GraphEntry {
  id: number;
  title: string;
  /** All declared Blocker IDs for this Task. */
  blockedBy: number[];
  /** Subset of `blockedBy` that are NOT yet in `resolvedIds`. */
  unresolvedBlockers: number[];
}

/**
 * The structured Plan produced and validated by the Plan phase.
 *
 * The Workflow consumes `unblockedSet` to drive the Execute phase; the
 * `graph` is retained for logging / observability.
 */
export interface Plan {
  /** Tasks selected for this Pass: zero unresolved Blockers, ordered, capped. */
  unblockedSet: Task[];
  /**
   * Full blocks/blocked-by graph over the ready Tasks.
   * One entry per input Task, regardless of whether it made it into the set.
   */
  graph: GraphEntry[];
  /** Total number of ready Tasks fed into the Plan (before filtering). */
  totalReady: number;
  /** Parallelism Cap applied to produce the Unblocked Set. */
  cap: number;
}

// ---------------------------------------------------------------------------
// Priority ranking (mirrors selectTasks in task.ts)
// ---------------------------------------------------------------------------

/**
 * Assign a numeric rank for the ordering policy:
 *   bug (0) → tracer (1) → polish (2) → refactor (3) → other (4)
 * Lower rank = higher priority.
 */
function taskPriority(task: Task): number {
  for (const label of task.labels) {
    const l = label.toLowerCase();
    if (l.includes("bug")) return 0;
    if (l.includes("tracer")) return 1;
    if (l.includes("polish")) return 2;
    if (l.includes("refactor")) return 3;
  }
  return 4;
}

// ---------------------------------------------------------------------------
// selectPlan
// ---------------------------------------------------------------------------

/**
 * Build the Unblocked Set for a single Pass.
 *
 * @param tasks      Ready Tasks, each annotated with their `blockedBy` edges.
 * @param resolvedIds  IDs of Tasks already merged into the Base Branch.
 *                   A Blocker whose ID is present here is considered resolved
 *                   and does NOT prevent the dependent Task from being selected.
 * @param cap        Parallelism Cap — maximum size of the Unblocked Set.
 * @returns          A validated Plan object.
 */
export function selectPlan(
  tasks: TaskWithBlockers[],
  resolvedIds: ReadonlySet<number>,
  cap: number,
): Plan {
  // Build graph: for every ready Task, compute its unresolved Blockers.
  const graph: GraphEntry[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    blockedBy: t.blockedBy,
    unresolvedBlockers: t.blockedBy.filter((bid) => !resolvedIds.has(bid)),
  }));

  // Unblocked = Tasks whose every declared Blocker is in resolvedIds.
  const unblocked = tasks.filter((t) =>
    t.blockedBy.every((bid) => resolvedIds.has(bid)),
  );

  // Apply ordering policy: priority tier first, then lowest id (oldest) first.
  const sorted = [...unblocked].sort((a, b) => {
    const pa = taskPriority(a);
    const pb = taskPriority(b);
    if (pa !== pb) return pa - pb;
    return a.id - b.id;
  });

  const unblockedSet: Task[] = sorted.slice(0, cap).map(({ id, title, labels }) => ({
    id,
    title,
    labels,
  }));

  return {
    unblockedSet,
    graph,
    totalReady: tasks.length,
    cap,
  };
}
