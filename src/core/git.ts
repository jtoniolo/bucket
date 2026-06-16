/**
 * Git predicates — the impure, integration-tested layer (ADR-0005).
 *
 * This shells out to `git`, so it is kept OUT of the pure core that gets inlined
 * into the Workflow (the Workflow sandbox has no child_process). At runtime the
 * Workflow obtains the same number by having an agent run the canonical command;
 * the argv builder in `./git-commands.ts` is the shared source of truth, and
 * this wrapper is exercised by integration tests against a temporary git repo.
 */

import { execFileSync } from "node:child_process";
import { commitsAheadOfBaseArgs } from "./git-commands.js";

export { commitsAheadOfBaseArgs } from "./git-commands.js";

export interface GitOptions {
  /** Repository working directory. Defaults to the process cwd. */
  cwd?: string;
}

/**
 * Commits-Ahead-of-Base: the structural test for whether a Task produced work.
 *
 * Returns the count of commits on `branch` not yet in `base`. The product trusts
 * this number, never an agent's self-reported "done": a branch with commits is
 * eligible for Merge; zero commits means nothing happened and the branch is
 * skipped (CONTEXT.md).
 */
export function commitsAheadOfBase(branch: string, base: string, options: GitOptions = {}): number {
  const out = execFileSync("git", commitsAheadOfBaseArgs(branch, base), {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
  });
  const n = Number.parseInt(out.trim(), 10);
  if (Number.isNaN(n)) {
    throw new Error(`commitsAheadOfBase: could not parse git output "${out.trim()}"`);
  }
  return n;
}
