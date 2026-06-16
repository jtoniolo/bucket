import { describe, it, expect } from "vitest";
import { resolveConfig, ENGINE_DEFAULTS } from "../src/core/config.js";
import { GITHUB_WORK_SOURCE } from "../src/core/worksource/github.js";

describe("resolveConfig", () => {
  it("returns Engine defaults for an empty config, with the GitHub work source", () => {
    const cfg = resolveConfig({});
    expect(cfg.baseBranch).toBe("main");
    expect(cfg.parallelismCap).toBe(3);
    expect(cfg.maxPasses).toBe(10);
    expect(cfg.commitPrefix).toBe("RALPH:");
    expect(cfg.workSource).toEqual(GITHUB_WORK_SOURCE);
  });

  it("bakes the configured prefix into the branch format, leaving only {id}", () => {
    expect(resolveConfig({}).branchFormat).toBe("ralph/issue-{id}");
    expect(resolveConfig({ branchPrefix: "auto" }).branchFormat).toBe("auto/issue-{id}");
  });

  it("lets the user config override Engine defaults", () => {
    const cfg = resolveConfig({ baseBranch: "dev", parallelismCap: 5, commitPrefix: "BOT:" });
    expect(cfg.baseBranch).toBe("dev");
    expect(cfg.parallelismCap).toBe(5);
    expect(cfg.commitPrefix).toBe("BOT:");
  });

  it("merges in order: defaults < preset < user", () => {
    const preset = { baseBranch: "develop", parallelismCap: 2 };
    const user = { parallelismCap: 4 };
    const cfg = resolveConfig(user, preset);
    expect(cfg.baseBranch).toBe("develop"); // from preset
    expect(cfg.parallelismCap).toBe(4); // user wins over preset
  });

  it("deep-merges workSource, keeping unspecified commands from defaults", () => {
    const cfg = resolveConfig({ workSource: { list: "custom-list --json" } });
    expect(cfg.workSource.list).toBe("custom-list --json");
    expect(cfg.workSource.view).toBe(GITHUB_WORK_SOURCE.view);
    expect(cfg.workSource.close).toBe(GITHUB_WORK_SOURCE.close);
  });

  it("deep-merges a single phase override without dropping the others", () => {
    const cfg = resolveConfig({ phases: { plan: { model: "opus", effort: "max" } } });
    expect(cfg.phases.plan).toEqual({ model: "opus", effort: "max" });
    expect(cfg.phases.execute).toEqual(ENGINE_DEFAULTS.phases.execute);
  });

  it("does not mutate ENGINE_DEFAULTS", () => {
    resolveConfig({ workSource: { list: "x --json" }, baseBranch: "dev" });
    expect(ENGINE_DEFAULTS.baseBranch).toBe("main");
    expect(ENGINE_DEFAULTS.workSource).toEqual(GITHUB_WORK_SOURCE);
  });

  describe("validation fails fast with a clear message", () => {
    it("rejects a non-positive parallelismCap", () => {
      expect(() => resolveConfig({ parallelismCap: 0 })).toThrow(/parallelismCap.*positive integer/);
    });

    it("rejects a non-integer maxPasses", () => {
      expect(() => resolveConfig({ maxPasses: 2.5 })).toThrow(/maxPasses.*positive integer/);
    });

    it("rejects an empty baseBranch", () => {
      expect(() => resolveConfig({ baseBranch: "" })).toThrow(/baseBranch.*non-empty string/);
    });

    it("rejects a branchFormat without an {id} placeholder", () => {
      expect(() => resolveConfig({ branchFormat: "ralph/issue" })).toThrow(/branchFormat.*\{id\}/);
    });

    it("rejects a view command without an {id} placeholder", () => {
      expect(() => resolveConfig({ workSource: { view: "gh issue view" } })).toThrow(
        /workSource\.view.*\{id\}/,
      );
    });

    it("rejects an empty work source command", () => {
      expect(() => resolveConfig({ workSource: { list: "" } })).toThrow(/workSource\.list.*non-empty/);
    });

    it("rejects a non-object config layer", () => {
      expect(() => resolveConfig([] as unknown as Record<string, unknown>)).toThrow(/must be a JSON object/);
    });
  });
});
