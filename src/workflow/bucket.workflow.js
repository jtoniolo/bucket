/**
 * Bucket Workflow — Plan → Execute → Review → Merge in a bounded outer Loop.
 *
 * Phase prompts live as Markdown files in the repo's `.bucket/` directory
 * (seeded from `prompts/` on first run). The Launcher CLI reads them and
 * passes them to the Workflow via `args.prompts`. The Workflow fills
 * `{{VAR}}` placeholders at runtime using `fillTemplate` before passing
 * each prompt to an agent.
 *
 * Authoring note: this file is the bundle SOURCE. `build/bundle.mjs` prepends
 * the pure core as an IIFE assigned to `__bucketCore` and writes the
 * self-contained `dist/bucket.workflow.js` (ADR-0005). `meta`, `agent`,
 * `phase`, `log`, and `args` are provided by the Workflow runtime.
 */

export const meta = {
  name: "bucket",
  description:
    "Bucket: autonomous Plan → Execute (parallel) → Review (parallel, crash salvage) → Merge loop, repeated until the Unblocked Set is empty or Max Passes is reached.",
  phases: [
    { title: "Plan", detail: "analyse ready Tasks, build a dependency graph, and select the unblocked set" },
    { title: "Execute", detail: "implement each Task concurrently on its deterministic branch in its own worktree" },
    { title: "Review", detail: "for each branch with commits, run a reviewer agent that improves clarity/correctness; salvage partial work from crashed implementers" },
    { title: "Merge", detail: "gate each branch on commits-ahead-of-base, then merge and close each Task" },
  ],
};

// __BUCKET_CORE_IIFE__  (build/bundle.mjs replaces this marker with the inlined core)

const { branchFor, fillCommand, fillTemplate, commitsAheadOfBaseArgs, shouldContinue } = __bucketCore;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "integer", description: "Task identifier (e.g. GitHub Issue number)." },
          title: { type: "string", description: "Task title." },
          context: { type: "string", description: "Optional notes for the implementer (e.g. resumption state, special instructions)." },
        },
      },
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
const prompts = cfg.prompts;

// ── Outer Loop ──────────────────────────────────────────────────────────────
let passesCompleted = 0;
const allMergeOutcomes = [];
let stopReason = "max-passes";

while (true) {
  const passLabel = `Pass ${passesCompleted + 1}/${cfg.maxPasses}`;
  log(`\n${"─".repeat(60)}\n Bucket ${passLabel} starting\n${"─".repeat(60)}`);

  // ── Plan ──────────────────────────────────────────────────────────────────
  phase(`Plan (${passLabel})`);
  const planPrompt = fillTemplate(prompts.plan, {
    LIST_COMMAND: cfg.workSource.list,
    VIEW_COMMAND_TEMPLATE: cfg.workSource.view,
    BASE_BRANCH: cfg.baseBranch,
    BRANCH_PREFIX: cfg.branchPrefix,
    PARALLELISM_CAP: String(cfg.parallelismCap),
  });

  const planResult = await agent(planPrompt, {
    label: "plan",
    phase: "Plan",
    model: cfg.phases.plan.model,
    effort: cfg.phases.plan.effort,
    schema: PLAN_SCHEMA,
  });

  const selectedTasks = (planResult.tasks || []).slice(0, cfg.parallelismCap);

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
  phase(`Execute (${passLabel})`);

  const testStep = cfg.test ? `Run the project's tests: \`${cfg.test}\`\n\n` : "";
  const lintStep = cfg.lint ? `Run the project's linter: \`${cfg.lint}\`\n\n` : "";

  const executeResults = await Promise.allSettled(
    taskBranches.map(({ task, branch, worktreePath }) => {
      const plannerContext = task.context
        ? `## Planner context\n\nThe planner noted: ${task.context}\n\n`
        : "";
      const prompt = fillTemplate(prompts.implement, {
        TASK_ID: String(task.id),
        TASK_TITLE: task.title,
        VIEW_COMMAND: fillCommand(cfg.workSource.view, { id: task.id }),
        BRANCH: branch,
        BASE_BRANCH: cfg.baseBranch,
        START_COMMAND: fillCommand(cfg.workSource.start, { id: task.id }),
        PLANNER_CONTEXT: plannerContext,
        TEST_STEP: testStep,
        LINT_STEP: lintStep,
        COMMIT_PREFIX: cfg.commitPrefix,
      });
      return agent(prompt, {
        label: `implement:issue-${task.id}`,
        phase: "Execute",
        model: cfg.phases.execute.model,
        effort: cfg.phases.execute.effort,
        schema: IMPLEMENT_SCHEMA,
        isolation: "worktree",
      });
    }),
  );

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
  phase(`Review (${passLabel})`);

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

  const testStepReview = cfg.test ? `Run the project's tests (\`${cfg.test}\`) to verify nothing broke.\n\n` : "";
  const lintStepReview = cfg.lint ? `Run the linter (\`${cfg.lint}\`).\n\n` : "";

  const reviewResults = await Promise.allSettled(
    branchesForReview.map(({ task, branch, worktreePath, implementerFailed }) => {
      const role = implementerFailed ? "salvage reviewer" : "reviewer";
      const salvageNote = implementerFailed
        ? "**Note:** the implementer crashed or timed out. Your job is to clean up whatever partial work was left so the branch is mergeable.\n\n"
        : "";
      const prompt = fillTemplate(prompts.review, {
        TASK_ID: String(task.id),
        ROLE: role,
        BRANCH: branch,
        BASE_BRANCH: cfg.baseBranch,
        SALVAGE_NOTE: salvageNote,
        TEST_STEP: testStepReview,
        LINT_STEP: lintStepReview,
        COMMIT_PREFIX: cfg.commitPrefix,
      });
      return agent(prompt, {
        label: `review:issue-${task.id}`,
        phase: "Review",
        model: cfg.phases.review.model,
        effort: cfg.phases.review.effort,
        schema: REVIEW_SCHEMA,
        isolation: "worktree",
      });
    }),
  );

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
    if (implementerFailed && !candidatesForMerge.some((c) => c.task.id === task.id)) {
      candidatesForMerge.push({ task, branch, worktreePath });
    }
  }

  // ── Merge ──────────────────────────────────────────────────────────────────
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

    const verifyStep = cfg.test ? `\n3. Verify the result by running \`${cfg.test}\`.` : "";
    const prompt = fillTemplate(prompts.merge, {
      TASK_ID: String(task.id),
      BRANCH: branch,
      BASE_BRANCH: cfg.baseBranch,
      VERIFY_STEP: verifyStep,
      CLOSE_COMMAND: fillCommand(cfg.workSource.close, { id: task.id }),
    });

    const merge = await agent(prompt, {
      label: `merge:issue-${task.id}`,
      phase: "Merge",
      model: cfg.phases.merge.model,
      effort: cfg.phases.merge.effort,
      schema: MERGE_SCHEMA,
    });

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
