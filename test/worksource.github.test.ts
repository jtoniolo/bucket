import { describe, it, expect } from "vitest";
import { GITHUB_WORK_SOURCE, GITHUB_START, READY_LABEL } from "../src/core/worksource/github.js";
import { fillCommand } from "../src/core/command.js";
import { parseTasks } from "../src/core/task.js";

// The adapter is tested by asserting the gh commands it builds and that its
// declared output shape round-trips through the Engine's parser — without ever
// hitting GitHub (PRD "Testing Decisions").
describe("GitHub Issues work source", () => {
  it("list filters open, ready-for-agent issues and emits the contract shape", () => {
    expect(GITHUB_WORK_SOURCE.list).toContain("gh issue list");
    expect(GITHUB_WORK_SOURCE.list).toContain("--state open");
    expect(GITHUB_WORK_SOURCE.list).toContain(`--label ${READY_LABEL}`);
    expect(GITHUB_WORK_SOURCE.list).toContain("id: .number");
  });

  it("view, close, and start carry an {id} placeholder the Engine fills per Task", () => {
    expect(GITHUB_WORK_SOURCE.view).toContain("{id}");
    expect(GITHUB_WORK_SOURCE.close).toContain("{id}");
    expect(GITHUB_WORK_SOURCE.start).toContain("{id}");
    expect(fillCommand(GITHUB_WORK_SOURCE.view, { id: 2 })).toBe(
      "gh issue view 2 --json number,title,body --jq '{id: .number, title: .title, body: .body}'",
    );
    expect(fillCommand(GITHUB_WORK_SOURCE.close, { id: 2 })).toContain("gh issue close 2");
    expect(fillCommand(GITHUB_WORK_SOURCE.start, { id: 2 })).toBe("gh issue edit 2 --add-label in-progress");
  });

  it("start labels the issue as in-progress via gh issue edit", () => {
    expect(GITHUB_START).toContain("gh issue edit");
    expect(GITHUB_START).toContain("--add-label in-progress");
  });

  it("never pushes or opens a PR", () => {
    for (const cmd of Object.values(GITHUB_WORK_SOURCE)) {
      expect(cmd).not.toContain("git push");
      expect(cmd).not.toContain("pr create");
    }
  });

  it("its declared list output shape parses as contract Tasks", () => {
    // A sample of what the documented `--jq` reshaping produces.
    const sampleListOutput = JSON.stringify([
      { id: 2, title: "Slice 1", labels: [READY_LABEL] },
    ]);
    expect(parseTasks(sampleListOutput)).toEqual([{ id: 2, title: "Slice 1", labels: [READY_LABEL] }]);
  });
});
