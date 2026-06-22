/**
 * Bucket Workflow — Slice 7: Distribution polish.
 *
 * Wraps Plan → Execute → Review → Merge in a bounded outer Loop that re-plans
 * on each Pass. Tasks unblocked by merges in one Pass become selectable in the
 * next because the Loop re-runs the `list` command at the start of every Pass.
 *
 * Termination (shouldContinue):
 *   - Loop stops when the Unblocked Set is empty (no ready work this Pass).
 *   - Loop stops when Max Passes is reached.
 *   - A zero-merge Pass does NOT stop the Loop (ADR-0004): partial progress is
 *     exactly the situation Resumption exists for.
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
    "Bucket: autonomous Plan → Execute (parallel) → Review (parallel, crash salvage) → Merge loop, repeated until the Unblocked Set is empty or Max Passes is reached.",
  phases: [
    { title: "Plan", detail: "list ready Tasks and select top N by ordering policy, bounded by Parallelism Cap" },
    { title: "Execute", detail: "implement each Task concurrently on its deterministic branch in its own worktree" },
    { title: "Review", detail: "for each branch with commits, run a reviewer agent that improves clarity/correctness; salvage partial work from crashed implementers" },
    { title: "Merge", detail: "gate each branch on commits-ahead-of-base, then merge and close each Task" },
  ],
};

// __BUCKET_CORE_IIFE__  (build/bundle.mjs replaces this marker with the inlined core)

// Pure deterministic core, inlined by the build step.
const { branchFor, fillCommand, parseTasks, selectTasks, commitsAheadOfBaseArgs, shouldContinue } = __bucketCore;

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

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["refined"],
  properties: {
    refined: { type: "boolean", description: "Whether any refinements were committed on the branch." },
    summary: { type: "string", description: "One-line summary of improvements made, or 'no changes needed'." },
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

// ── Outer Loop ──────────────────────────────────────────────────────────────
// Each iteration is one Pass: Plan → Execute → Review → Merge.
// The Loop re-plans at the start of every Pass so Tasks unblocked by the
// previous Pass's merges are picked up next (Resumption).
let passesCompleted = 0;
const allMergeOutcomes = [];
let stopReason = "max-passes";

while (true) {
  const passLabel = `Pass ${passesCompleted + 1}/${cfg.maxPasses}`;
  log(`\n${"─".repeat(60)}\n Bucket ${passLabel} starting\n${"─".repeat(60)}`);

  // ── Plan ──────────────────────────────────────────────────────────────────
  // The `list` command is the sole source of truth for ready work. Run it in
  // an agent, then make the selection deterministically in JS using the
  // ordering policy and Parallelism Cap.
  phase(`Plan (${passLabel})`);
  const listResult = await agent(
    `Run exactly this shell command and return its stdout verbatim, with no commentary:\n\n` +
      `    ${cfg.workSource.list}\n\n` +
      `Do not modify, reformat, or summarise the output. Return the raw stdout.`,
    { label: "worksource:list", phase: "Plan", model: cfg.phases.plan.model, effort: cfg.phases.plan.effort, schema: TASK_LIST_SCHEMA },
  );

  const allTasks = parseTasks(listResult.stdout);
  const selectedTasks = selectTasks(allTasks, cfg.parallelismCap);

  // Check termination before executing this Pass.
  if (!shouldContinue(passesCompleted, cfg.maxPasses, selectedTasks.length)) {
    if (selectedTasks.length === 0) {
      log(`Plan (${passLabel}): Unblocked Set is empty — no ready Tasks. Loop complete.`);
      stopReason = "empty-unblocked-set";
    } else {
      log(`Plan (${passLabel}): reached Max Passes (${cfg.maxPasses}). Loop complete.`);
      stopReason = "max-passes";
    }
    break;
  }

  const taskBranches = selectedTasks.map((t) => ({
    task: t,
    branch: branchFor(t, cfg.branchFormat),
    worktreePath: `.bucket/worktrees/issue-${t.id}`,
  }));

  log(
    `Plan (${passLabel}): selected ${selectedTasks.length} Task(s) (cap=${cfg.parallelismCap}): ` +
      taskBranches.map(({ task, branch }) => `#${task.id} "${task.title}" → ${branch}`).join(", "),
  );

  // ── Execute ────────────────────────────────────────────────────────────────
  // All selected Tasks run concurrently, each in its own worktree on its own
  // deterministic branch. Promise.allSettled isolates per-Task failures: one
  // failing implementer does not cancel its siblings.
  phase(`Execute (${passLabel})`);
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
        `Execute (${passLabel}): Task #${task.id} committed=${impl.committed}` +
          (impl.summary ? ` — ${impl.summary}` : ""),
      );
      candidatesForMerge.push({ task, branch, worktreePath });
    } else {
      log(`Execute (${passLabel}): Task #${task.id} FAILED — ${result.reason} — branch left open for Resumption.`);
    }
  }

  // ── Review ──────────────────────────────────────────────────────────────────
  // For every Task branch that produced commits (Commits-Ahead-of-Base > 0), a
  // reviewer agent runs on the same branch to improve clarity and correctness
  // without changing behaviour. Branches with zero commits are skipped.
  //
  // Crash salvage: if an implementer failed (Promise.allSettled "rejected") but
  // still left commits on its branch, a salvage reviewer runs so the partial work
  // is cleaned up and becomes mergeable. The Merge phase re-checks commit counts
  // independently, so commits from both implementer and reviewer are accounted for.
  phase(`Review (${passLabel})`);
  const testStepReview = cfg.test ? `Run the project's tests (\`${cfg.test}\`) to verify nothing broke. ` : "";
  const lintStepReview = cfg.lint ? `Run the linter (\`${cfg.lint}\`). ` : "";

  // Gate every task branch in parallel — fulfilled and failed implementers alike.
  const reviewGateResults = await Promise.allSettled(
    taskBranches.map(({ task, branch }) => {
      const gitCountCmd = `git ${commitsAheadOfBaseArgs(branch, cfg.baseBranch).join(" ")}`;
      return agent(
        `Run exactly this command from the repository root and return its integer stdout:\n\n    ${gitCountCmd}\n`,
        {
          label: `gate:review:issue-${task.id}`,
          phase: "Review",
          model: cfg.phases.review.model,
          schema: COUNT_SCHEMA,
        },
      );
    }),
  );

  // Build the list of branches eligible for review (commits > 0).
  const branchesForReview = [];
  for (let i = 0; i < taskBranches.length; i++) {
    const { task, branch, worktreePath } = taskBranches[i];
    const gateResult = reviewGateResults[i];
    const implementerFailed = executeResults[i].status === "rejected";
    if (gateResult.status === "fulfilled" && gateResult.value.count > 0) {
      branchesForReview.push({ task, branch, worktreePath, implementerFailed });
    } else {
      log(`Review (${passLabel}): branch ${branch} has 0 commits ahead of ${cfg.baseBranch} — skipping reviewer.`);
    }
  }

  // Run all reviewer agents in parallel (Promise.allSettled — one failure doesn't
  // block others). Salvage reviewers get an explicit note in their prompt.
  const reviewResults = await Promise.allSettled(
    branchesForReview.map(({ task, branch, worktreePath, implementerFailed }) => {
      const role = implementerFailed ? "salvage reviewer" : "reviewer";
      const salvageNote = implementerFailed
        ? `\nNote: the implementer crashed or timed out. Your job is to clean up whatever partial work was left so the branch is mergeable.\n`
        : "";
      return agent(
        [
          `You are Bucket's ${role} for Task #${task.id}.`,
          ``,
          `The implementer has already committed work on branch \`${branch}\` (worktree: ${worktreePath}).`,
          `Your job is to improve clarity and correctness on that same branch WITHOUT changing behaviour.`,
          salvageNote,
          `1. Review all commits on \`${branch}\` not yet in \`${cfg.baseBranch}\`:`,
          `   \`git log ${cfg.baseBranch}..${branch} --oneline\` (run from ${worktreePath}).`,
          `2. Make improvements: rename unclear identifiers, improve comments, fix typos, add/tighten`,
          `   tests, remove dead code. Do NOT change observable behaviour, public APIs, or architectural`,
          `   decisions.`,
          `3. ${testStepReview}${lintStepReview}`,
          `4. If you made any changes, commit them with a message beginning with "${cfg.commitPrefix}" followed by a space.`,
          `   If no refinements are needed, do NOT create an empty commit.`,
          ``,
          `Hard constraints (never violate): do NOT run \`git push\`, \`gh pr create\`, \`--no-verify\`,`,
          `force-push, or any history rewrite. Stay on branch \`${branch}\` only.`,
        ]
          .filter((line) => line !== undefined)
          .join("\n"),
        {
          label: `review:issue-${task.id}`,
          phase: "Review",
          model: cfg.phases.review.model,
          effort: cfg.phases.review.effort,
          schema: REVIEW_SCHEMA,
        },
      );
    }),
  );

  // Log reviewer outcomes and fold salvage branches into candidatesForMerge.
  for (let i = 0; i < branchesForReview.length; i++) {
    const { task, branch, worktreePath, implementerFailed } = branchesForReview[i];
    const result = reviewResults[i];
    const tag = implementerFailed ? " (salvage)" : "";
    if (result.status === "fulfilled") {
      const rev = result.value;
      log(`Review (${passLabel}): Task #${task.id}${tag} refined=${rev.refined}` + (rev.summary ? ` — ${rev.summary}` : ""));
    } else {
      log(`Review (${passLabel}): Task #${task.id}${tag} reviewer FAILED — ${result.reason} — proceeding to Merge with implementer commits only.`);
    }
    // Salvage branches were not added to candidatesForMerge by the Execute phase
    // (their implementer was rejected). Add them now so the Merge phase sees them.
    if (implementerFailed && !candidatesForMerge.some((c) => c.task.id === task.id)) {
      candidatesForMerge.push({ task, branch, worktreePath });
    }
  }

  // ── Merge ──────────────────────────────────────────────────────────────────
  // For every candidate branch (fulfilled implementers + salvage branches), gate
  // on Commits-Ahead-of-Base, then merge and close. Processed sequentially to
  // avoid concurrent git checkout conflicts.
  phase(`Merge (${passLabel})`);
  const passOutcomes = [];

  for (const { task, branch, worktreePath } of candidatesForMerge) {
    const gitCountCmd = `git ${commitsAheadOfBaseArgs(branch, cfg.baseBranch).join(" ")}`;
    const gate = await agent(
      `Run exactly this command from the repository root and return its integer stdout:\n\n    ${gitCountCmd}\n`,
      {
        label: `gate:commits-ahead:issue-${task.id}`,
        phase: "Merge",
        model: cfg.phases.merge.model,
        effort: cfg.phases.merge.effort,
        schema: COUNT_SCHEMA,
      },
    );

    if (gate.count <= 0) {
      log(`Merge (${passLabel}): branch ${branch} has 0 commits ahead of ${cfg.baseBranch} — skipping (Task left open).`);
      passOutcomes.push({ task: task.id, branch, status: "skipped", reason: "zero commits ahead of base" });
      continue;
    }

    log(`Merge (${passLabel}): branch ${branch} is ${gate.count} commit(s) ahead — merging into ${cfg.baseBranch}.`);
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

    log(`Merge (${passLabel}): merged=${merge.merged} closed=${merge.closed} for Task #${task.id}.`);
    passOutcomes.push({ task: task.id, branch, status: "merged", commitsAhead: gate.count, merge });
  }

  allMergeOutcomes.push(...passOutcomes);
  passesCompleted++;

  const mergedCount = passOutcomes.filter((o) => o.status === "merged").length;
  const skippedCount = passOutcomes.filter((o) => o.status === "skipped").length;
  log(
    `\n${passLabel} complete — merged: ${mergedCount}, skipped: ${skippedCount}` +
      (mergedCount === 0 ? " (no merges this pass; Loop continues per ADR-0004)" : ""),
  );

  // ADR-0004: do NOT check merge count here. A zero-merge Pass is not a stop
  // signal; the next Pass's shouldContinue check (at the top of the loop) is
  // the only progress gate. If the Unblocked Set is still non-empty and passes
  // remain, the Loop continues regardless of how many merges just happened.
}

const totalMerged = allMergeOutcomes.filter((o) => o.status === "merged").length;
log(
  `\n${"═".repeat(60)}\n Bucket done — ${passesCompleted} pass(es), ${totalMerged} task(s) merged` +
    ` (stop reason: ${stopReason})\n${"═".repeat(60)}`,
);

return {
  status: "done",
  passes: passesCompleted,
  stopReason,
  parallelismCap: cfg.parallelismCap,
  maxPasses: cfg.maxPasses,
  mergeOutcomes: allMergeOutcomes,
};
