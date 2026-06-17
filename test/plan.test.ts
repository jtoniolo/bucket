import { describe, it, expect } from "vitest";
import { selectPlan, type TaskWithBlockers, type Plan } from "../src/core/plan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function t(id: number, labels: string[] = [], blockedBy: number[] = []): TaskWithBlockers {
  return { id, title: `Task ${id}`, labels, blockedBy };
}

const EMPTY = new Set<number>();

// ---------------------------------------------------------------------------
// selectPlan — Blocker filtering
// ---------------------------------------------------------------------------

describe("selectPlan — Blocker filtering", () => {
  it("returns all tasks as unblocked when none have blockedBy edges", () => {
    const tasks = [t(1), t(2), t(3)];
    const plan = selectPlan(tasks, EMPTY, 10);
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("excludes a task whose blocker is unresolved (not in resolvedIds)", () => {
    const tasks = [t(1), t(2, [], [1])]; // task 2 is blocked by task 1
    const plan = selectPlan(tasks, EMPTY, 10);
    // task 1 is unresolved (not in resolvedIds) so task 2 must be excluded
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([1]);
  });

  it("includes a task when all its blockers are resolved", () => {
    const tasks = [t(2, [], [1])]; // task 1 is not in the list (already merged)
    const resolved = new Set([1]);
    const plan = selectPlan(tasks, resolved, 10);
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([2]);
  });

  it("excludes a task blocked by an unmerged task even if other blockers are resolved", () => {
    // task 3 is blocked by tasks 1 (resolved) and 2 (unresolved)
    const tasks = [t(2), t(3, [], [1, 2])];
    const resolved = new Set([1]);
    const plan = selectPlan(tasks, resolved, 10);
    // task 2 is in tasks and NOT in resolvedIds → still unresolved
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([2]);
  });

  it("is unblocked only when every blocker is resolved", () => {
    const tasks = [t(3, [], [1, 2])];
    const resolved = new Set([1, 2]);
    const plan = selectPlan(tasks, resolved, 10);
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([3]);
  });

  it("returns empty unblockedSet when all tasks are blocked", () => {
    const tasks = [t(2, [], [1]), t(3, [], [1])];
    const plan = selectPlan(tasks, EMPTY, 10);
    expect(plan.unblockedSet).toEqual([]);
  });

  it("handles an empty task list gracefully", () => {
    const plan = selectPlan([], EMPTY, 5);
    expect(plan.unblockedSet).toEqual([]);
    expect(plan.graph).toEqual([]);
    expect(plan.totalReady).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// selectPlan — Ordering & tie-breaks
// ---------------------------------------------------------------------------

describe("selectPlan — Ordering policy", () => {
  it("orders by policy: bug → tracer → polish → refactor → other", () => {
    const tasks = [
      t(1, ["refactor"]),
      t(2, ["polish"]),
      t(3, ["tracer-bullet"]),
      t(4, ["bug"]),
    ];
    const plan = selectPlan(tasks, EMPTY, 10);
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([4, 3, 2, 1]);
  });

  it("breaks ties within the same priority tier by lowest id first", () => {
    const tasks = [t(10, ["bug"]), t(5, ["bug"]), t(7, ["bug"])];
    const plan = selectPlan(tasks, EMPTY, 10);
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([5, 7, 10]);
  });

  it("treats unlabelled tasks as lowest priority (after refactor)", () => {
    const tasks = [t(1), t(2, ["refactor"])];
    const plan = selectPlan(tasks, EMPTY, 10);
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([2, 1]);
  });

  it("is deterministic across multiple calls", () => {
    const tasks = [t(3, ["refactor"]), t(1, ["bug"]), t(2, ["polish"])];
    const ids1 = selectPlan(tasks, EMPTY, 10).unblockedSet.map((x) => x.id);
    const ids2 = selectPlan(tasks, EMPTY, 10).unblockedSet.map((x) => x.id);
    expect(ids1).toEqual(ids2);
  });
});

// ---------------------------------------------------------------------------
// selectPlan — Cap truncation
// ---------------------------------------------------------------------------

describe("selectPlan — Cap truncation", () => {
  it("truncates the unblockedSet to the parallelism cap", () => {
    const tasks = [t(1), t(2), t(3), t(4)];
    const plan = selectPlan(tasks, EMPTY, 2);
    expect(plan.unblockedSet).toHaveLength(2);
  });

  it("cap of 1 returns only the single highest-priority task", () => {
    const tasks = [t(3, ["polish"]), t(1, ["bug"]), t(2, ["tracer"])];
    const plan = selectPlan(tasks, EMPTY, 1);
    expect(plan.unblockedSet.map((x) => x.id)).toEqual([1]);
  });

  it("returns all tasks when count is below the cap", () => {
    const tasks = [t(1), t(2)];
    const plan = selectPlan(tasks, EMPTY, 5);
    expect(plan.unblockedSet).toHaveLength(2);
  });

  it("records the cap in the plan output", () => {
    const plan = selectPlan([t(1)], EMPTY, 3);
    expect(plan.cap).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// selectPlan — Graph output
// ---------------------------------------------------------------------------

describe("selectPlan — Graph output", () => {
  it("includes all ready tasks in the graph regardless of blocker status", () => {
    const tasks = [t(1), t(2, [], [1])];
    const plan = selectPlan(tasks, EMPTY, 10);
    expect(plan.graph.map((e) => e.id)).toEqual([1, 2]);
  });

  it("reports zero unresolvedBlockers for fully unblocked tasks", () => {
    const plan = selectPlan([t(1)], EMPTY, 10);
    expect(plan.graph[0]?.unresolvedBlockers).toEqual([]);
  });

  it("reports the correct unresolvedBlockers for a blocked task", () => {
    const tasks = [t(1), t(2, [], [1])];
    const plan = selectPlan(tasks, EMPTY, 10);
    const entry = plan.graph.find((e) => e.id === 2);
    expect(entry?.blockedBy).toEqual([1]);
    expect(entry?.unresolvedBlockers).toEqual([1]);
  });

  it("does not report a resolved blocker as unresolved", () => {
    const tasks = [t(2, [], [1])];
    const resolved = new Set([1]);
    const plan = selectPlan(tasks, resolved, 10);
    const entry = plan.graph.find((e) => e.id === 2);
    expect(entry?.unresolvedBlockers).toEqual([]);
  });

  it("records totalReady as the count of all input tasks", () => {
    const tasks = [t(1), t(2, [], [1]), t(3, [], [1])];
    const plan = selectPlan(tasks, EMPTY, 10);
    expect(plan.totalReady).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// selectPlan — Return shape matches Plan interface
// ---------------------------------------------------------------------------

describe("selectPlan — Return shape", () => {
  it("returns a Plan with all required fields", () => {
    const plan: Plan = selectPlan([t(1)], EMPTY, 3);
    expect(plan).toHaveProperty("unblockedSet");
    expect(plan).toHaveProperty("graph");
    expect(plan).toHaveProperty("totalReady");
    expect(plan).toHaveProperty("cap");
  });

  it("unblockedSet tasks carry id, title, and labels (Task shape)", () => {
    const plan = selectPlan([t(1, ["bug"])], EMPTY, 3);
    const task = plan.unblockedSet[0];
    expect(task).toMatchObject({ id: 1, title: "Task 1", labels: ["bug"] });
  });
});
