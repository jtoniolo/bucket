/**
 * Bucket Workflow — Slice 2: Parallel Execute with Parallelism Cap.
 *
 * Extends the Slice 1 skeleton to work several Tasks per Pass in parallel.
 * The Work Source `list` returns multiple ready Tasks; the top N are selected
 * by the ordering policy (bug → tracer → polish → refactor) and bounded by the
 * Parallelism Cap (default 3). Each Task runs concurrently in its own
 * worktree/branch. Per-Task failure is isolated via Promise.allSettled — one
 * failing implementer does not cancel its siblings. After Execute, all branches
 * with Commits-Ahead-of-Base > 0 are merged sequentially into the Base Branch.
 *
 * Still no Plan dependency graph and no Review phase — those arrive in later
 * slices. Deterministic decisions (branch names, merge gate) are computed here
 * in JS from the inlined pure core; all shell/git/gh mutation happens inside
 * spawned agents, because the Workflow sandbox has no shell.
 *
 * Authoring note: this file is the bundle SOURCE. `build/bundle.mjs` prepends
 * the pure core as an IIFE assigned to `__bucketCore` and writes the
 * self-contained `dist/bucket.workflow.js` (ADR-0005). `meta`, `agent`,
 * `phase`, `log`, and `args` are provided by the Workflow runtime; the bundler
 * injects `__bucketCore`.
 */

export const meta = {
  name: "bucket",
  description:
    "Bucket Slice 2: select up to N ready Tasks by priority, implement them in parallel in isolated worktrees, merge all branches with commits into the base branch.",
  phases: [
    { title: "Plan", detail: "list ready Tasks and select top N by ordering policy, bounded by Parallelism Cap" },
    { title: "Execute", detail: "implement each Task concurrently on its deterministic branch in its own worktree" },
    { title: "Merge", detail: "gate each branch on commits-ahead-of-base, then merge and close each Task" },
  ],
};

// __BUCKET_CORE_IIFE__  (build/bundle.mjs replaces this marker with the inlined core)

// Pure deterministic core, inlined by the build step.
const { branchFor, fillCommand, parseTasks, selectTasks, commitsAheadOfBaseArgs } = __bucketCore;

const TASK_LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stdout"],
  properties: {
    stdout: {
      type: "string",
      description: "The exact, unmodified stdout of the command (a JSON array of Tasks).",
    },
  },
};

const IMPLEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["committed"],
  properties: {
    committed: { type: "boolean", description: "Whether at least one commit was made on the branch." },
    summary: { type: "string", description: "One-line summary of what was done." },
  },
};

const COUNT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["count"],
  properties: {
    count: { type: "integer", description: "Integer stdout of the git rev-list command." },
  },
};

const MERGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["merged"],
  properties: {
    merged: { type: "boolean", description: "Whether the branch was merged into the base branch." },
    closed: { type: "boolean", description: "Whether the Task was closed via the work source." },
    notes: { type: "string", description: "Any conflicts resolved or verification output worth noting." },
  },
};

const cfg = args;

// ── Plan ────────────────────────────────────────────────────────────────────
// The `list` command is the sole source of truth for ready work. Run it in an
// agent, then make the selection deterministically in JS using the ordering
// policy and Parallelism Cap.
phase("Plan");
const listResult = await agent(
  `Run exactly this shell command and return its stdout verbatim, with no commentary:\n\n` +
    `    ${cfg.workSource.list}\n\n` +
    `Do not modify, reformat, or summarise the output. Return the raw stdout.`,
  { label: "worksource:list", phase: "Plan", model: cfg.phases.plan.model, schema: TASK_LIST_SCHEMA },
);

const allTasks = parseTasks(listResult.stdout);
const selectedTasks = selectTasks(allTasks, cfg.parallelismCap);

if (selectedTasks.length === 0) {
  log("Plan: no ready Tasks — nothing to do.");
  return { status: "empty", reason: "no ready tasks" };
}

const taskBranches = selectedTasks.map((t) => ({
  task: t,
  branch: branchFor(t, cfg.branchFormat),
  worktreePath: `.bucket/worktrees/issue-${t.id}`,
}));

log(
  `Plan: selected ${selectedTasks.length} Task(s) (cap=${cfg.parallelismCap}): ` +
    taskBranches.map(({ task, branch }) => `#${task.id} "${task.title}" → ${branch}`).join(", "),
);

// ── Execute ──────────────────────────────────────────────────────────────────
// All selected Tasks run concurrently, each in its own worktree on its own
// deterministic branch. Promise.allSettled isolates per-Task failures: one
// failing implementer does not cancel its siblings.
phase("Execute");
const testStep = cfg.test ? `Run the project's tests: \`${cfg.test}\`. ` : "";
const lintStep = cfg.lint ? `Run the project's linter: \`${cfg.lint}\`. ` : "";

const executeResults = await Promise.allSettled(
  taskBranches.map(({ task, branch, worktreePath }) => {
    const viewCommand = fillCommand(cfg.workSource.view, { id: task.id });
    return agent(
      [
        `You are Bucket's implementer for Task #${task.id}.`,
        ``,
        `1. Read the full Task body by running: \`${viewCommand}\` (and read any parent doc it references).`,
        `2. Set up an isolated git worktree on the deterministic branch \`${branch}\`, based on \`${cfg.baseBranch}\`:`,
        `   - If branch \`${branch}\` already exists, resume it: \`git worktree add ${worktreePath} ${branch}\`.`,
        `   - Otherwise create it: \`git worktree add -b ${branch} ${worktreePath} ${cfg.baseBranch}\`.`,
        `   Do all of your work inside ${worktreePath}.`,
        `3. Implement the Task test-first. ${testStep}${lintStep}`,
        `4. Commit your work. EVERY commit message MUST begin with the prefix "${cfg.commitPrefix}" followed by a space.`,
        ``,
        `Hard constraints (never violate): do NOT run \`git push\`, \`gh pr create\`, \`--no-verify\`,`,
        `force-push, or any history rewrite. Leave the branch and its worktree in place; do not delete them.`,
        `If you cannot finish, commit whatever compiles — partial progress is resumed next time.`,
      ].join("\n"),
      {
        label: `implement:issue-${task.id}`,
        phase: "Execute",
        model: cfg.phases.execute.model,
        effort: cfg.phases.execute.effort,
        schema: IMPLEMENT_SCHEMA,
      },
    );
  }),
);

// Log each implementer's outcome; collect the branches that need merge-gating.
const candidatesForMerge = [];
for (let i = 0; i < taskBranches.length; i++) {
  const { task, branch, worktreePath } = taskBranches[i];
  const result = executeResults[i];
  if (result.status === "fulfilled") {
    const impl = result.value;
    log(
      `Execute: Task #${task.id} committed=${impl.committed}` +
        (impl.summary ? ` — ${impl.summary}` : ""),
    );
    candidatesForMerge.push({ task, branch, worktreePath });
  } else {
    log(`Execute: Task #${task.id} FAILED — ${result.reason} — branch left open for Resumption.`);
  }
}

// ── Merge ─────────────────────────────────────────────────────────────────────
// For every branch that came from a successful implementer, gate on
// Commits-Ahead-of-Base, then merge and close. Processed sequentially to avoid
// concurrent git checkout conflicts. Failed implementers are skipped entirely —
// their branches remain open for Resumption on the next Pass.
phase("Merge");
const mergeOutcomes = [];

for (const { task, branch, worktreePath } of candidatesForMerge) {
  const gitCountCmd = `git ${commitsAheadOfBaseArgs(branch, cfg.baseBranch).join(" ")}`;
  const gate = await agent(
    `Run exactly this command from the repository root and return its integer stdout:\n\n    ${gitCountCmd}\n`,
    {
      label: `gate:commits-ahead:issue-${task.id}`,
      phase: "Merge",
      model: cfg.phases.merge.model,
      schema: COUNT_SCHEMA,
    },
  );

  if (gate.count <= 0) {
    log(`Merge: branch ${branch} has 0 commits ahead of ${cfg.baseBranch} — skipping (Task left open).`);
    mergeOutcomes.push({ task: task.id, branch, status: "skipped", reason: "zero commits ahead of base" });
    continue;
  }

  log(`Merge: branch ${branch} is ${gate.count} commit(s) ahead — merging into ${cfg.baseBranch}.`);
  const closeCommand = fillCommand(cfg.workSource.close, { id: task.id });
  const merge = await agent(
    [
      `You are Bucket's merge step for Task #${task.id}.`,
      ``,
      `1. Check out \`${cfg.baseBranch}\` in the main working tree and merge branch \`${branch}\` into it,`,
      `   resolving any conflicts. Then verify the result${cfg.test ? ` by running \`${cfg.test}\`` : ""}.`,
      `2. Remove the Task's worktree: \`git worktree remove ${worktreePath}\` (use \`--force\` only if needed).`,
      `3. Report the Task complete via the work source: \`${closeCommand}\`.`,
      ``,
      `Hard constraints (never violate): do NOT run \`git push\`, \`gh pr create\`, \`--no-verify\`,`,
      `force-push, or any history rewrite. The merge stays local.`,
    ].join("\n"),
    {
      label: `merge:issue-${task.id}`,
      phase: "Merge",
      model: cfg.phases.merge.model,
      effort: cfg.phases.merge.effort,
      schema: MERGE_SCHEMA,
    },
  );

  log(`Merge: merged=${merge.merged} closed=${merge.closed} for Task #${task.id}.`);
  mergeOutcomes.push({ task: task.id, branch, status: "merged", commitsAhead: gate.count, merge });
}

return {
  status: "done",
  selected: selectedTasks.length,
  parallelismCap: cfg.parallelismCap,
  mergeOutcomes,
};
