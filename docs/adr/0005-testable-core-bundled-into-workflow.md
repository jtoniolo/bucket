# Deterministic orchestration logic lives in a tested core, bundled into the Workflow

Bucket's value proposition includes running the loop *deterministically*. Workflow scripts, however, run in a restricted sandbox with no filesystem or Node API access, and the agents they spawn are not unit-testable. To keep the deterministic parts verifiable, we separate them from the parts that aren't.

The deterministic decision logic — plan selection (dependency filtering, ordering, Parallelism Cap truncation, Resumption prioritization), config resolution, the loop-termination decision, and branch-name formatting — lives in a plain, vitest-tested core module. The Workflow script is a thin shell that imports those functions and wires them to the agent fan-out. Because the script cannot read files at runtime, the core is **inlined/bundled into the script at author/build time**.

## Consequences

- The determinism that justifies the product is covered by fast, hermetic unit tests; agent quality is explicitly out of scope for automated tests.
- A build/author step produces the final self-contained Workflow script from the core module + the thin shell. Editing the core means re-bundling.
- Git-touching predicates (e.g. commits-ahead-of-base) are thin wrappers tested as integration tests against a temporary git repo, kept separate from the pure core.
