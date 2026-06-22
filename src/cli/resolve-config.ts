/**
 * resolve-config CLI — the deterministic half of the Launcher (ADR-0003).
 *
 * The `/bucket:run` slash command runs this. It reads `bucket.config.json` from the
 * current repo, resolves the active Preset (if any), validates the merged
 * config, and prints the single ResolvedConfig as JSON to stdout. On any error
 * it prints a clear message to stderr and exits non-zero, so a bad config fails
 * fast — before the Launcher ever invokes the Workflow.
 *
 * Usage: node resolve-config.mjs [path/to/bucket.config.json]
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { resolveConfig, type RawConfig } from "../core/config.js";

function fail(message: string): never {
  process.stderr.write(`bucket: ${message}\n`);
  process.exit(1);
}

function readJson(path: string, label: string): RawConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`could not read ${label} at ${path}`);
  }
  try {
    return JSON.parse(text) as RawConfig;
  } catch (err) {
    return fail(`${label} at ${path} is not valid JSON: ${(err as Error).message}`);
  }
}

function main(): void {
  const configPath = resolve(process.argv[2] ?? "bucket.config.json");
  const raw = readJson(configPath, "bucket.config.json");

  // Resolve the active Preset if one is named. Presets live in self-contained
  // directories next to the config: `presets/<name>/preset.config.json`.
  let preset: RawConfig | undefined;
  const presetName = raw.preset;
  if (presetName !== undefined && presetName !== null) {
    if (typeof presetName !== "string" || presetName.trim() === "") {
      fail(`"preset" must be a non-empty string or null (got ${JSON.stringify(presetName)})`);
    }
    const presetPath = join(dirname(configPath), "presets", presetName, "preset.config.json");
    preset = readJson(presetPath, `preset "${presetName}"`);
  }

  // Strip the launcher-only `preset` pointer before resolving the Engine config.
  const { preset: _ignored, ...userConfig } = raw;

  try {
    const resolved = resolveConfig(userConfig, preset);
    process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
  } catch (err) {
    fail((err as Error).message);
  }
}

main();
