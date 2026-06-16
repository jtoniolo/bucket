/**
 * Inline entry for the Workflow bundle.
 *
 * `build/bundle.mjs` bundles exactly these pure functions into an IIFE that the
 * self-contained Workflow script reads from (ADR-0005). Only side-effect-free,
 * Node-builtin-free exports may appear here — the impure git executor and the
 * filesystem-touching config loader are deliberately excluded.
 */

export { branchFor } from "./branch.js";
export { fillCommand } from "./command.js";
export { parseTasks, selectHighestPriority, selectTasks } from "./task.js";
export { commitsAheadOfBaseArgs } from "./git-commands.js";
