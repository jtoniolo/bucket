/**
 * Pure core barrel — the deterministic seams that get inlined into the Workflow
 * (ADR-0005). Everything re-exported here is free of filesystem / child_process
 * access so it is safe to bundle into the Workflow sandbox.
 *
 * The impure git wrapper lives in `./git.ts` and is imported directly by the
 * (Node-only) tests and CLI, never from here.
 */

export { branchFor, type TaskRef } from "./branch.js";
export { fillCommand, type CommandVars } from "./command.js";
export { parseTasks, selectHighestPriority, selectTasks, type Task } from "./task.js";
export {
  resolveConfig,
  ENGINE_DEFAULTS,
  type ResolvedConfig,
  type WorkSourceCommands,
  type PhaseConfig,
  type RawConfig,
} from "./config.js";
export { GITHUB_WORK_SOURCE, READY_LABEL } from "./worksource/github.js";
export {
  selectPlan,
  type TaskWithBlockers,
  type GraphEntry,
  type Plan,
} from "./plan.js";
export { shouldContinue } from "./loop.js";
