/**
 * Config resolution — Engine defaults ⊕ Preset ⊕ user config, then validation.
 *
 * `resolveConfig` is the tested seam from ADR-0005. Per ADR-0003 the Launcher
 * (the `/bucket:run` command) runs this, NOT the Workflow: the Workflow sandbox has
 * no filesystem access, so the Launcher resolves a single ResolvedConfig and
 * hands it to the Workflow as `args`. Validation fails fast with a clear,
 * actionable message so a typo is caught before any agent is spawned.
 */

import { GITHUB_WORK_SOURCE } from "./worksource/github.js";

export interface WorkSourceCommands {
  /** Emit ready Tasks as a JSON array (the sole source of truth for work). */
  list: string;
  /** Read one Task's full body. Carries an `{id}` placeholder. */
  view: string;
  /** Mark one Task done / transition its status. Carries an `{id}` placeholder. */
  close: string;
  /** Mark one Task as in-progress before implementation begins. Carries an `{id}` placeholder. */
  start: string;
}

export interface PhaseConfig {
  model: string;
  effort: string;
}

export interface ResolvedConfig {
  baseBranch: string;
  branchPrefix: string;
  /** Fully-resolved branch template containing `{id}` (e.g. `ralph/issue-{id}`). */
  branchFormat: string;
  commitPrefix: string;
  maxPasses: number;
  parallelismCap: number;
  workSource: WorkSourceCommands;
  /** Shell command that runs the changed projects' tests. */
  test: string;
  /** Shell command that runs the changed projects' linters. */
  lint: string;
  phases: {
    plan: PhaseConfig;
    execute: PhaseConfig;
    review: PhaseConfig;
    merge: PhaseConfig;
  };
}

/**
 * Engine defaults. Repo-agnostic: contains no Preset-specific values. The
 * GitHub Issues Work Source is the v1 default; a Preset may override it.
 */
export const ENGINE_DEFAULTS: ResolvedConfig = {
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
    merge: { model: "sonnet", effort: "medium" },
  },
};

/** Raw config as written in `.bucket/config.json` or supplied by a Preset. */
export type RawConfig = Record<string, unknown>;

class ConfigError extends Error {
  constructor(message: string) {
    super(`Invalid bucket config: ${message}`);
    this.name = "ConfigError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeWorkSource(
  base: WorkSourceCommands,
  override: unknown,
  who: string,
): WorkSourceCommands {
  if (override === undefined) return base;
  if (!isPlainObject(override)) {
    throw new ConfigError(`"workSource" in ${who} must be an object`);
  }
  return {
    list: (override.list as string) ?? base.list,
    view: (override.view as string) ?? base.view,
    close: (override.close as string) ?? base.close,
    start: (override.start as string) ?? base.start,
  };
}

function mergePhases(
  base: ResolvedConfig["phases"],
  override: unknown,
  who: string,
): ResolvedConfig["phases"] {
  if (override === undefined) return base;
  if (!isPlainObject(override)) {
    throw new ConfigError(`"phases" in ${who} must be an object`);
  }
  const out = { ...base };
  for (const name of ["plan", "execute", "review", "merge"] as const) {
    const p = override[name];
    if (p === undefined) continue;
    if (!isPlainObject(p)) {
      throw new ConfigError(`"phases.${name}" in ${who} must be an object`);
    }
    out[name] = {
      model: (p.model as string) ?? base[name].model,
      effort: (p.effort as string) ?? base[name].effort,
    };
  }
  return out;
}

/** Shallow-merge the flat, scalar config keys, letting `override` win. */
function mergeLayer(
  base: ResolvedConfig,
  layer: RawConfig | undefined,
  who: string,
): ResolvedConfig {
  if (layer === undefined) return base;
  if (!isPlainObject(layer)) {
    throw new ConfigError(`${who} must be a JSON object`);
  }
  const pick = <T>(key: keyof ResolvedConfig, current: T): T =>
    layer[key as string] !== undefined ? (layer[key as string] as T) : current;

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
    phases: mergePhases(base.phases, layer.phases, who),
  };
}

function requireNonEmptyString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`"${key}" must be a non-empty string (got ${JSON.stringify(value)})`);
  }
  return value;
}

function requirePositiveInt(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ConfigError(`"${key}" must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function validate(cfg: ResolvedConfig): ResolvedConfig {
  requireNonEmptyString(cfg.baseBranch, "baseBranch");
  requireNonEmptyString(cfg.branchPrefix, "branchPrefix");
  requireNonEmptyString(cfg.commitPrefix, "commitPrefix");
  requirePositiveInt(cfg.maxPasses, "maxPasses");
  requirePositiveInt(cfg.parallelismCap, "parallelismCap");

  requireNonEmptyString(cfg.branchFormat, "branchFormat");
  if (!cfg.branchFormat.includes("{id}")) {
    throw new ConfigError(`"branchFormat" must contain the "{id}" placeholder (got "${cfg.branchFormat}")`);
  }

  for (const k of ["list", "view", "close", "start"] as const) {
    requireNonEmptyString(cfg.workSource[k], `workSource.${k}`);
  }
  for (const k of ["view", "close", "start"] as const) {
    if (!cfg.workSource[k].includes("{id}")) {
      throw new ConfigError(`"workSource.${k}" must contain the "{id}" placeholder so the Engine can target one Task`);
    }
  }

  for (const name of ["plan", "execute", "review", "merge"] as const) {
    requireNonEmptyString(cfg.phases[name].model, `phases.${name}.model`);
    requireNonEmptyString(cfg.phases[name].effort, `phases.${name}.effort`);
  }
  return cfg;
}

/**
 * Resolve and validate a Bucket config.
 *
 * Merge order (later wins): Engine defaults → Preset → user `.bucket/config.json`.
 * After merging, `{prefix}` in the branch format is baked in from `branchPrefix`,
 * leaving a template that only `branchFor` needs to fill (`{id}`). Throws a
 * `ConfigError` with a clear message on the first invalid field.
 */
export function resolveConfig(rawConfig: RawConfig = {}, preset?: RawConfig): ResolvedConfig {
  let cfg = ENGINE_DEFAULTS;
  cfg = mergeLayer(cfg, preset, "preset");
  cfg = mergeLayer(cfg, rawConfig, ".bucket/config.json");

  // Bake the configured prefix into the branch template so the Workflow only
  // has to fill `{id}` at runtime.
  const branchFormat = cfg.branchFormat.replaceAll("{prefix}", cfg.branchPrefix);
  cfg = { ...cfg, branchFormat };

  return validate(cfg);
}
