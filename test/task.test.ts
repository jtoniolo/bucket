import { describe, it, expect } from "vitest";
import { parseTasks, selectHighestPriority } from "../src/core/task.js";

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
