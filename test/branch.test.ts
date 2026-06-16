import { describe, it, expect } from "vitest";
import { branchFor } from "../src/core/branch.js";

describe("branchFor", () => {
  it("fills {id} from the Task to produce a deterministic branch name", () => {
    expect(branchFor({ id: 2 }, "ralph/issue-{id}")).toBe("ralph/issue-2");
  });

  it("is deterministic — same inputs, same output", () => {
    const a = branchFor({ id: 42 }, "ralph/issue-{id}");
    const b = branchFor({ id: 42 }, "ralph/issue-{id}");
    expect(a).toBe(b);
    expect(a).toBe("ralph/issue-42");
  });

  it("accepts a string id", () => {
    expect(branchFor({ id: "abc" }, "auto/issue-{id}")).toBe("auto/issue-abc");
  });

  it("replaces every occurrence of {id}", () => {
    expect(branchFor({ id: 7 }, "{id}/issue-{id}")).toBe("7/issue-7");
  });

  it("throws when the format has no {id} placeholder", () => {
    expect(() => branchFor({ id: 1 }, "ralph/issue")).toThrow(/\{id\}/);
  });

  it("throws on an empty format", () => {
    expect(() => branchFor({ id: 1 }, "")).toThrow(/non-empty string/);
  });

  it("throws when the Task has no id", () => {
    expect(() => branchFor({ id: "" }, "ralph/issue-{id}")).toThrow(/missing an id/);
  });
});
