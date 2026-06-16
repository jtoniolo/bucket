import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitsAheadOfBase } from "../src/core/git.js";

/**
 * Integration test (ADR-0005): exercise the impure git wrapper against a real,
 * temporary git repository — no mocks.
 */
describe("commitsAheadOfBase (integration, temp git repo)", () => {
  let repo: string;

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const commit = (file: string, msg: string) => {
    writeFileSync(join(repo, file), `${msg}\n`);
    git("add", file);
    git("commit", "-m", msg);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "bucket-git-"));
    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Bucket Test");
    commit("base.txt", "base commit");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("counts commits a branch is ahead of base", () => {
    git("checkout", "-b", "ralph/issue-2");
    commit("a.txt", "RALPH: first");
    commit("b.txt", "RALPH: second");
    expect(commitsAheadOfBase("ralph/issue-2", "main", { cwd: repo })).toBe(2);
  });

  it("returns 0 for a branch with no commits ahead (the skip case)", () => {
    git("checkout", "main");
    git("checkout", "-b", "ralph/issue-empty");
    expect(commitsAheadOfBase("ralph/issue-empty", "main", { cwd: repo })).toBe(0);
  });

  it("returns 0 after the branch has been merged into base", () => {
    git("checkout", "main");
    git("merge", "--no-ff", "ralph/issue-2", "-m", "merge issue-2");
    expect(commitsAheadOfBase("ralph/issue-2", "main", { cwd: repo })).toBe(0);
  });
});
