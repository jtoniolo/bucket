#!/usr/bin/env node

// src/cli/resolve-config.ts
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// src/core/worksource/github.ts
var READY_LABEL = "ready-for-agent";
var GITHUB_LIST = `gh issue list --state open --label ${READY_LABEL} --json number,title,labels --jq 'map({id: .number, title: .title, labels: [.labels[].name]})'`;
var GITHUB_VIEW = `gh issue view {id} --json number,title,body --jq '{id: .number, title: .title, body: .body}'`;
var GITHUB_CLOSE = `gh issue close {id} --comment "Completed by Bucket."`;
var GITHUB_WORK_SOURCE = {
  list: GITHUB_LIST,
  view: GITHUB_VIEW,
  close: GITHUB_CLOSE
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
    close: override.close ?? base.close
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
  for (const k of ["list", "view", "close"]) {
    requireNonEmptyString(cfg.workSource[k], `workSource.${k}`);
  }
  if (!cfg.workSource.view.includes("{id}")) {
    throw new ConfigError(`"workSource.view" must contain the "{id}" placeholder so the Engine can target one Task`);
  }
  if (!cfg.workSource.close.includes("{id}")) {
    throw new ConfigError(`"workSource.close" must contain the "{id}" placeholder so the Engine can target one Task`);
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
  cfg = mergeLayer(cfg, rawConfig, "bucket.config.json");
  const branchFormat = cfg.branchFormat.replaceAll("{prefix}", cfg.branchPrefix);
  cfg = { ...cfg, branchFormat };
  return validate(cfg);
}

// src/cli/resolve-config.ts
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
function main() {
  const configPath = resolve(process.argv[2] ?? "bucket.config.json");
  const raw = readJson(configPath, "bucket.config.json");
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
    process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
  } catch (err) {
    fail(err.message);
  }
}
main();
