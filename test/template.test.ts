import { describe, it, expect } from "vitest";
import { fillTemplate } from "../src/core/template.js";

describe("fillTemplate", () => {
  it("substitutes {{VAR}} placeholders", () => {
    expect(fillTemplate("Hello {{NAME}}", { NAME: "world" })).toBe("Hello world");
  });

  it("replaces multiple different placeholders", () => {
    expect(fillTemplate("{{A}} and {{B}}", { A: "x", B: "y" })).toBe("x and y");
  });

  it("replaces all occurrences of the same placeholder", () => {
    expect(fillTemplate("{{X}} then {{X}}", { X: "v" })).toBe("v then v");
  });

  it("replaces unknown placeholders with empty string", () => {
    expect(fillTemplate("before {{MISSING}} after", {})).toBe("before  after");
  });

  it("leaves single-brace {id} placeholders untouched", () => {
    expect(fillTemplate("gh issue view {id}", {})).toBe("gh issue view {id}");
  });

  it("handles a template with no placeholders", () => {
    expect(fillTemplate("plain text", { A: "unused" })).toBe("plain text");
  });

  it("handles empty template", () => {
    expect(fillTemplate("", { A: "v" })).toBe("");
  });

  it("handles multiline templates", () => {
    const tpl = "line1 {{A}}\nline2 {{B}}\n";
    expect(fillTemplate(tpl, { A: "x", B: "y" })).toBe("line1 x\nline2 y\n");
  });
});
