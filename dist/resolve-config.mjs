#!/usr/bin/env node

// src/cli/resolve-config.ts
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// src/core/worksource/github.ts
var READY_LABEL = "ready-for-agent";
var GITHUB_LIST = `gh issue list --state open --label ${READY_LABEL} --json number,title,labels --jq 'map({id: .number, title: .title, labels: [.labels[].name]})'`;
var GITHUB_VIEW = `gh issue view {id} --json number,title,body --jq '{id: .number, title: .title, body: .body}'`;
var GITHUB_CLOSE = `gh issue close {id} --comment "Completed by Bucket."`;
var GITHUB_START = `gh issue edit {id} --add-label in-progress`;
var GITHUB_WORK_SOURCE = {
  list: GITHUB_LIST,
  view: GITHUB_VIEW,
  close: GITHUB_CLOSE,
  start: GITHUB_START
};

// src/core/config.ts
var ENGINE_DEFAULTS = {
  baseBranch: "main",
  branchPrefix: "ralph",
  branchFormat: "{prefix}/issue-{id}",
  commitPrefix: "RALPH:",
  maxPasses: 10,
  parallelismCap: 3,
  workSource: { ...GITHUB_WORK_SOURCE },
  test: "",
  lint: "",
  phases: {
    plan: { model: "opus", effort: "high" },
    execute: { model: "sonnet", effort: "medium" },
    review: { model: "sonnet", effort: "medium" },
    merge: { model: "sonnet", effort: "medium" }
  }
};
var ConfigError = class extends Error {
  constructor(message) {
    super(`Invalid bucket config: ${message}`);
    this.name = "ConfigError";
  }
};
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function mergeWorkSource(base, override, who) {
  if (override === void 0) return base;
  if (!isPlainObject(override)) {
    throw new ConfigError(`"workSource" in ${who} must be an object`);
  }
  return {
    list: override.list ?? base.list,
    view: override.view ?? base.view,
    close: override.close ?? base.close,
    start: override.start ?? base.start
  };
}
function mergePhases(base, override, who) {
  if (override === void 0) return base;
  if (!isPlainObject(override)) {
    throw new ConfigError(`"phases" in ${who} must be an object`);
  }
  const out = { ...base };
  for (const name of ["plan", "execute", "review", "merge"]) {
    const p = override[name];
    if (p === void 0) continue;
    if (!isPlainObject(p)) {
      throw new ConfigError(`"phases.${name}" in ${who} must be an object`);
    }
    out[name] = {
      model: p.model ?? base[name].model,
      effort: p.effort ?? base[name].effort
    };
  }
  return out;
}
function mergeLayer(base, layer, who) {
  if (layer === void 0) return base;
  if (!isPlainObject(layer)) {
    throw new ConfigError(`${who} must be a JSON object`);
  }
  const pick = (key, current) => layer[key] !== void 0 ? layer[key] : current;
  return {
    baseBranch: pick("baseBranch", base.baseBranch),
    branchPrefix: pick("branchPrefix", base.branchPrefix),
    branchFormat: pick("branchFormat", base.branchFormat),
    commitPrefix: pick("commitPrefix", base.commitPrefix),
    maxPasses: pick("maxPasses", base.maxPasses),
    parallelismCap: pick("parallelismCap", base.parallelismCap),
    workSource: mergeWorkSource(base.workSource, layer.workSource, who),
    test: pick("test", base.test),
    lint: pick("lint", base.lint),
    phases: mergePhases(base.phases, layer.phases, who)
  };
}
function requireNonEmptyString(value, key) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`"${key}" must be a non-empty string (got ${JSON.stringify(value)})`);
  }
  return value;
}
function requirePositiveInt(value, key) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ConfigError(`"${key}" must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return value;
}
function validate(cfg) {
  requireNonEmptyString(cfg.baseBranch, "baseBranch");
  requireNonEmptyString(cfg.branchPrefix, "branchPrefix");
  requireNonEmptyString(cfg.commitPrefix, "commitPrefix");
  requirePositiveInt(cfg.maxPasses, "maxPasses");
  requirePositiveInt(cfg.parallelismCap, "parallelismCap");
  requireNonEmptyString(cfg.branchFormat, "branchFormat");
  if (!cfg.branchFormat.includes("{id}")) {
    throw new ConfigError(`"branchFormat" must contain the "{id}" placeholder (got "${cfg.branchFormat}")`);
  }
  for (const k of ["list", "view", "close", "start"]) {
    requireNonEmptyString(cfg.workSource[k], `workSource.${k}`);
  }
  for (const k of ["view", "close", "start"]) {
    if (!cfg.workSource[k].includes("{id}")) {
      throw new ConfigError(`"workSource.${k}" must contain the "{id}" placeholder so the Engine can target one Task`);
    }
  }
  for (const name of ["plan", "execute", "review", "merge"]) {
    requireNonEmptyString(cfg.phases[name].model, `phases.${name}.model`);
    requireNonEmptyString(cfg.phases[name].effort, `phases.${name}.effort`);
  }
  return cfg;
}
function resolveConfig(rawConfig = {}, preset) {
  let cfg = ENGINE_DEFAULTS;
  cfg = mergeLayer(cfg, preset, "preset");
  cfg = mergeLayer(cfg, rawConfig, ".bucket/config.json");
  const branchFormat = cfg.branchFormat.replaceAll("{prefix}", cfg.branchPrefix);
  cfg = { ...cfg, branchFormat };
  return validate(cfg);
}

// prompts/plan-prompt.md
var plan_prompt_default = '# TASK\n\nYou are the Planner. Fetch the list of ready Tasks from the Work Source and select which ones to work this pass.\n\n## Fetch ready Tasks\n\nRun this command to get the current list of ready Tasks:\n\n```\n{{LIST_COMMAND}}\n```\n\nUse `{{VIEW_COMMAND_TEMPLATE}}` (replacing `{id}` with the Task identifier) to read the full body of any Task you need more context on.\n\n## Build a dependency graph\n\nFor each Task, determine whether it **blocks** or **is blocked by** any other Task.\n\nA Task B is **blocked by** Task A if:\n\n- B requires code or infrastructure that A introduces\n- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts\n- B\'s requirements depend on a decision or API shape that A will establish\n\nA Task is **unblocked** if it has zero unresolved Blockers among the remaining ready Tasks.\n\n## Detect resumption\n\nCheck for branches from previous passes:\n\n```\ngit branch -a | grep "{{BRANCH_PREFIX}}"\n```\n\nFor each matching branch, check commits ahead of base:\n\n```\ngit log --oneline {{BASE_BRANCH}}..<branch-name>\n```\n\n- **If the branch has commits ahead of `{{BASE_BRANCH}}`** \u2014 the Task needs resumption. Include it in your plan with a `context` field describing the state (e.g. "Resuming \u2014 branch has N commits from a previous pass, check existing work before starting fresh").\n- **If the branch has zero commits** \u2014 treat as a fresh start.\n\n## Resolving Blockers\n\nA Blocker is **resolved** if its work has been merged into `{{BASE_BRANCH}}`. Before declaring a Task blocked, verify whether the Blocker\'s branch was merged:\n\n```\ngit log --oneline {{BASE_BRANCH}} | grep -i "<blocker-slug>"\n```\n\nIf the branch appears in `{{BASE_BRANCH}}` history, the Blocker is resolved \u2014 treat the downstream Task as unblocked.\n\nYou MUST verify that Blockers are merged into `{{BASE_BRANCH}}` before declaring a Task blocked. If a Blocker is NOT merged, the blocking Task MUST be re-executed before downstream work can begin.\n\n## Priority order\n\nSelect unblocked Tasks using this ordering:\n\n1. **Resumptions first** \u2014 Tasks with existing branches that need completion take priority.\n2. **Priority field** \u2014 higher priority Tasks first (if the Work Source provides priority).\n3. **Work type** as a tiebreaker:\n   1. Bug fixes \u2014 broken behaviour affecting users\n   2. Tracer bullets \u2014 thin end-to-end slices that prove an approach works\n   3. Polish \u2014 improving existing functionality\n   4. Refactors \u2014 internal cleanups with no user-visible change\n\nSelect at most **{{PARALLELISM_CAP}}** Tasks.\n\n# OUTPUT\n\nReturn your plan as a JSON object matching this schema:\n\n```json\n{\n  "tasks": [\n    {\n      "id": 42,\n      "title": "Fix auth bug",\n      "context": "Optional notes for the implementer"\n    }\n  ]\n}\n```\n\nFields:\n\n- `id` (integer, required): Task identifier (e.g. GitHub Issue number).\n- `title` (string, required): Task title.\n- `context` (string, optional): Situational notes for the implementer \u2014 resumption state, special instructions, known issues from previous attempts. Omit for fresh starts with no special context.\n\nInclude only unblocked Tasks, up to **{{PARALLELISM_CAP}}**. If every Task is blocked, return an empty `tasks` array.\n';

// prompts/implement-prompt.md
var implement_prompt_default = '# TASK\n\nImplement Task #{{TASK_ID}}: {{TASK_TITLE}}\n\nRead the full Task body:\n\n```\n{{VIEW_COMMAND}}\n```\n\nIf the Task references a parent specification, read that too.\n\nWork ONLY on this single Task. Do NOT work on any other Task.\n\n## Mark in progress\n\nBefore doing any other work, mark the Task as started:\n\n```\n{{START_COMMAND}}\n```\n\n## Code quality\n\nYou MUST follow every rule, convention, and constraint defined in this repository. Read the project\'s documentation and configuration files before writing any code.\n\nThere are NO pre-existing test failures or lint errors. If tests or lint fail on your branch, YOU own the failure \u2014 fix it.\n\n{{PLANNER_CONTEXT}}\n\n## Resume check\n\nBefore starting work, check if your branch already has commits ahead of the base:\n\n```\ngit log --oneline {{BASE_BRANCH}}..HEAD\n```\n\nIf there are existing commits, you are **resuming** a previous attempt that may have failed or timed out. Read the existing code and tests, assess what is already done versus what remains, and continue from there. Do NOT redo completed work.\n\nIf there are no commits, this is a fresh start.\n\n## Exploration\n\nExplore the repository to understand the codebase. Read files, tests, and documentation relevant to this Task. Fill your context with enough information to implement the change correctly.\n\n## Execution \u2014 TDD is mandatory\n\nYou MUST use Red-Green-Refactor (TDD) for all implementation work:\n\n1. **RED**: Write one failing test that specifies the next piece of behaviour.\n2. **GREEN**: Write the minimum implementation to make that test pass.\n3. **REPEAT** steps 1\u20132 until the Task is fully implemented.\n4. **REFACTOR**: Clean up the code while keeping all tests green.\n\n## Feedback loops\n\n{{TEST_STEP}}{{LINT_STEP}}Fix every failure before committing. You MUST NOT skip or bypass any pre-commit hooks.\n\n## Commit\n\nMake a git commit. The commit message MUST:\n\n1. Start with the `{{COMMIT_PREFIX}}` prefix\n2. Summarise the Task completed\n3. Note key decisions made\n4. List files changed\n\nKeep it concise.\n\nDo NOT close the Task \u2014 that happens in the Merge phase.\n\n## Output\n\nReturn a JSON object matching this schema:\n\n```json\n{\n  "committed": true,\n  "summary": "One-line summary of what was done"\n}\n```\n\nFields:\n\n- `committed` (boolean, required): Whether at least one commit was made on the branch.\n- `summary` (string): One-line summary of what was done.\n\n## Safety rails\n\n- Work on a SINGLE Task only.\n- Do NOT create pull requests. Do NOT run `gh pr create`. Do NOT push to remote.\n';

// prompts/review-prompt.md
var review_prompt_default = '# TASK\n\nYou are the {{ROLE}} for Task #{{TASK_ID}} on branch `{{BRANCH}}`.\n\n{{SALVAGE_NOTE}}\n\n## Branch context\n\nReview the diff against the base branch:\n\n```\ngit diff {{BASE_BRANCH}}...{{BRANCH}}\n```\n\nReview the commits on this branch:\n\n```\ngit log {{BASE_BRANCH}}..{{BRANCH}} --oneline\n```\n\n## Code quality\n\nThere are NO pre-existing test failures or lint errors. If tests or lint fail on this branch, the failure MUST be fixed.\n\n## Review checklist\n\n1. **Understand the change**: Read the diff and commits to understand the intent.\n\n2. **Check correctness**:\n   - Does the implementation match the Task\'s intent? Are edge cases handled?\n   - Are new or changed behaviours covered by tests?\n   - Are there unsafe casts, `any` types, or unchecked assumptions?\n   - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?\n\n3. **Improve clarity**:\n   - Reduce unnecessary complexity and nesting\n   - Eliminate redundant code and abstractions\n   - Improve readability through clear variable and function names\n   - Consolidate related logic\n   - Remove unnecessary comments that describe obvious code\n   - Avoid nested ternary operators \u2014 prefer switch statements or if/else chains\n   - Choose clarity over brevity \u2014 explicit code is often better than overly compact code\n\n4. **Maintain balance** \u2014 do NOT over-simplify in ways that:\n   - Reduce code clarity or maintainability\n   - Create overly clever solutions that are hard to understand\n   - Combine too many concerns into single functions or components\n   - Remove helpful abstractions that improve code organization\n   - Make the code harder to debug or extend\n\n5. **Preserve functionality**: NEVER change what the code does \u2014 only how it does it. All original features, outputs, and behaviours MUST remain intact.\n\n## Execution\n\n{{TEST_STEP}}{{LINT_STEP}}If you find improvements to make:\n\n1. Make the changes directly on this branch.\n2. Run tests and lint. Fix every failure.\n3. Commit describing the refinements with the `{{COMMIT_PREFIX}}` prefix.\n\nIf the code is already clean and well-structured, do nothing.\n\n## Output\n\nReturn a JSON object matching this schema:\n\n```json\n{\n  "refined": true,\n  "summary": "One-line summary of improvements made, or \'no changes needed\'"\n}\n```\n\nFields:\n\n- `refined` (boolean, required): Whether any refinements were committed on the branch.\n- `summary` (string): One-line summary of improvements made, or "no changes needed".\n';

// prompts/merge-prompt.md
var merge_prompt_default = '# TASK\n\nMerge branch `{{BRANCH}}` (Task #{{TASK_ID}}) into `{{BASE_BRANCH}}`.\n\n## Steps\n\n1. Check out `{{BASE_BRANCH}}` and pull latest.\n2. Run `git merge {{BRANCH}} --no-edit`.\n3. If there are merge conflicts, resolve them by reading both sides and choosing the correct resolution.{{VERIFY_STEP}}\n\nAfter a successful merge, close the Task:\n\n```\n{{CLOSE_COMMAND}}\n```\n\n## Output\n\nReturn a JSON object matching this schema:\n\n```json\n{\n  "merged": true,\n  "closed": true,\n  "notes": "Any conflicts resolved or verification output worth noting"\n}\n```\n\nFields:\n\n- `merged` (boolean, required): Whether the branch was merged into `{{BASE_BRANCH}}`.\n- `closed` (boolean): Whether the Task was closed via the Work Source.\n- `notes` (string): Any conflicts resolved or verification output worth noting.\n';

// src/cli/resolve-config.ts
var PROMPT_DEFAULTS = {
  plan: plan_prompt_default,
  implement: implement_prompt_default,
  review: review_prompt_default,
  merge: merge_prompt_default
};
var PROMPT_NAMES = ["plan", "implement", "review", "merge"];
function fail(message) {
  process.stderr.write(`bucket: ${message}
`);
  process.exit(1);
}
function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`could not read ${label} at ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return fail(`${label} at ${path} is not valid JSON: ${err.message}`);
  }
}
function resolvePrompts(bucketDir) {
  mkdirSync(bucketDir, { recursive: true });
  const prompts = {};
  for (const name of PROMPT_NAMES) {
    const p = join(bucketDir, `${name}-prompt.md`);
    if (!existsSync(p)) {
      writeFileSync(p, PROMPT_DEFAULTS[name], "utf8");
    }
    prompts[name] = readFileSync(p, "utf8");
  }
  return prompts;
}
function main() {
  const configPath = resolve(process.argv[2] ?? ".bucket/config.json");
  const raw = readJson(configPath, ".bucket/config.json");
  let preset;
  const presetName = raw.preset;
  if (presetName !== void 0 && presetName !== null) {
    if (typeof presetName !== "string" || presetName.trim() === "") {
      fail(`"preset" must be a non-empty string or null (got ${JSON.stringify(presetName)})`);
    }
    const presetPath = join(dirname(configPath), "presets", presetName, "preset.config.json");
    preset = readJson(presetPath, `preset "${presetName}"`);
  }
  const { preset: _ignored, ...userConfig } = raw;
  try {
    const resolved = resolveConfig(userConfig, preset);
    const prompts = resolvePrompts(dirname(configPath));
    process.stdout.write(JSON.stringify({ ...resolved, prompts }, null, 2) + "\n");
  } catch (err) {
    fail(err.message);
  }
}
main();
