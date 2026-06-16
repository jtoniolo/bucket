/**
 * Pure git-command builders.
 *
 * These construct git argv but never execute anything, so they are safe to
 * inline into the Workflow sandbox. The impure executor that actually runs them
 * lives in `./git.ts` and reuses these builders, keeping a single source of
 * truth for each command's exact shape.
 */

/**
 * The git argv that counts commits on `branch` not yet in `base` — the
 * Commits-Ahead-of-Base test. Used both by the integration-tested wrapper and
 * by the Workflow's merge gate prompt, so the two never drift.
 */
export function commitsAheadOfBaseArgs(branch: string, base: string): string[] {
  return ["rev-list", "--count", `${base}..${branch}`];
}
