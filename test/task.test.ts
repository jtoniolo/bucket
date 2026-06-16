import { describe, it, expect } from "vitest";
import { parseTasks, selectHighestPriority, selectTasks } from "../src/core/task.js";

describe("parseTasks", () => {
  it("parses the contract Task array from list stdout", () => {
    const json = JSON.stringify([
      { id: 2, title: "Walking skeleton", labels: ["ready-for-agent"] },
      { id: 5, title: "Plan phase", labels: [] },
    ]);
    expect(parseTasks(json)).toEqual([
      { id: 2, title: "Walking skeleton", labels: ["ready-for-agent"] },
      { id: 5, title: "Plan phase", labels: [] },
    ]);
  });

  it("defaults labels to an empty array when absent", () => {
    expect(parseTasks(JSON.stringify([{ id: 1, title: "x" }]))[0]?.labels).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTasks("not json")).toThrow(/valid JSON/);
  });

  it("throws when the payload is not an array", () => {
    expect(() => parseTasks(JSON.stringify({ id: 1 }))).toThrow(/array of Tasks/);
  });

  it("throws when a Task is missing a numeric id", () => {
    expect(() => parseTasks(JSON.stringify([{ title: "x" }]))).toThrow(/numeric "id"/);
  });
});

describe("selectHighestPriority", () => {
  it("returns null when nothing is ready", () => {
    expect(selectHighestPriority([])).toBeNull();
  });

  it("selects the lowest-id Task (slice-1 oldest-first policy)", () => {
    const tasks = [
      { id: 9, title: "b", labels: [] },
      { id: 2, title: "a", labels: [] },
      { id: 4, title: "c", labels: [] },
    ];
    expect(selectHighestPriority(tasks)?.id).toBe(2);
  });

  it("is deterministic across runs", () => {
    const tasks = [
      { id: 3, title: "a", labels: [] },
      { id: 1, title: "b", labels: [] },
    ];
    expect(selectHighestPriority(tasks)?.id).toBe(selectHighestPriority(tasks)?.id);
  });
});

describe("selectTasks", () => {
  it("returns empty array when no tasks", () => {
    expect(selectTasks([], 3)).toEqual([]);
  });

  it("truncates to the parallelism cap", () => {
    const tasks = [
      { id: 1, title: "a", labels: [] },
      { id: 2, title: "b", labels: [] },
      { id: 3, title: "c", labels: [] },
      { id: 4, title: "d", labels: [] },
    ];
    expect(selectTasks(tasks, 3)).toHaveLength(3);
  });

  it("returns all tasks when count is below cap", () => {
    const tasks = [
      { id: 1, title: "a", labels: [] },
      { id: 2, title: "b", labels: [] },
    ];
    expect(selectTasks(tasks, 5)).toHaveLength(2);
  });

  it("orders bug-labelled tasks first", () => {
    const tasks = [
      { id: 1, title: "refactor", labels: ["refactor"] },
      { id: 2, title: "bug fix", labels: ["bug"] },
      { id: 3, title: "polish", labels: ["polish"] },
    ];
    const result = selectTasks(tasks, 3);
    expect(result[0]?.id).toBe(2);
  });

  it("orders by policy: bug → tracer → polish → refactor", () => {
    const tasks = [
      { id: 1, title: "refactor", labels: ["refactor"] },
      { id: 2, title: "polish", labels: ["polish"] },
      { id: 3, title: "tracer", labels: ["tracer-bullet"] },
      { id: 4, title: "bug fix", labels: ["bug"] },
    ];
    const result = selectTasks(tasks, 4);
    expect(result.map((t) => t.id)).toEqual([4, 3, 2, 1]);
  });

  it("breaks ties within same priority by lowest id first", () => {
    const tasks = [
      { id: 10, title: "bug b", labels: ["bug"] },
      { id: 5, title: "bug a", labels: ["bug"] },
      { id: 7, title: "bug c", labels: ["bug"] },
    ];
    const result = selectTasks(tasks, 3);
    expect(result.map((t) => t.id)).toEqual([5, 7, 10]);
  });

  it("treats unlabelled tasks as lowest priority (after refactor)", () => {
    const tasks = [
      { id: 1, title: "unlabelled", labels: [] },
      { id: 2, title: "refactor", labels: ["refactor"] },
    ];
    const result = selectTasks(tasks, 2);
    expect(result[0]?.id).toBe(2);
    expect(result[1]?.id).toBe(1);
  });

  it("cap of 1 returns only the highest-priority task", () => {
    const tasks = [
      { id: 3, title: "polish", labels: ["polish"] },
      { id: 1, title: "bug", labels: ["bug"] },
      { id: 2, title: "tracer", labels: ["tracer"] },
    ];
    expect(selectTasks(tasks, 1).map((t) => t.id)).toEqual([1]);
  });

  it("is deterministic across calls", () => {
    const tasks = [
      { id: 3, title: "a", labels: ["refactor"] },
      { id: 1, title: "b", labels: ["bug"] },
      { id: 2, title: "c", labels: ["polish"] },
    ];
    expect(selectTasks(tasks, 3).map((t) => t.id)).toEqual(
      selectTasks(tasks, 3).map((t) => t.id),
    );
  });
});
