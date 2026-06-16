import { describe, it, expect } from "vitest";
import { fillCommand } from "../src/core/command.js";

describe("fillCommand", () => {
  it("substitutes {id} into a view/close template", () => {
    expect(fillCommand("gh issue view {id} --json body", { id: 2 })).toBe(
      "gh issue view 2 --json body",
    );
  });

  it("replaces every {id} occurrence", () => {
    expect(fillCommand("x {id} y {id}", { id: 7 })).toBe("x 7 y 7");
  });

  it("passes through a template with no placeholder", () => {
    expect(fillCommand("gh issue list --json number")).toBe("gh issue list --json number");
  });

  it("throws when an {id} is required but missing", () => {
    expect(() => fillCommand("gh issue view {id}")).toThrow(/needs an "\{id\}"/);
  });

  it("throws on an empty template", () => {
    expect(() => fillCommand("")).toThrow(/non-empty string/);
  });
});
