import { describe, it, expect } from "vitest";
import { shouldContinue } from "../src/core/loop.js";

// ---------------------------------------------------------------------------
// shouldContinue — empty Unblocked Set
// ---------------------------------------------------------------------------

describe("shouldContinue — empty Unblocked Set", () => {
  it("returns false when the Unblocked Set is empty on the first Pass", () => {
    expect(shouldContinue(0, 10, 0)).toBe(false);
  });

  it("returns false when the Unblocked Set is empty mid-loop", () => {
    expect(shouldContinue(3, 10, 0)).toBe(false);
  });

  it("returns false when the Unblocked Set is empty and Max Passes is also reached", () => {
    // Both stop conditions active — empty set wins; must still be false.
    expect(shouldContinue(10, 10, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldContinue — Max Passes
// ---------------------------------------------------------------------------

describe("shouldContinue — Max Passes", () => {
  it("returns false when passesCompleted equals maxPasses", () => {
    expect(shouldContinue(10, 10, 5)).toBe(false);
  });

  it("returns false when passesCompleted exceeds maxPasses", () => {
    expect(shouldContinue(11, 10, 5)).toBe(false);
  });

  it("returns true on the last allowable Pass (passesCompleted = maxPasses - 1)", () => {
    expect(shouldContinue(9, 10, 5)).toBe(true);
  });

  it("honours a maxPasses of 1: stops after the single Pass is done", () => {
    expect(shouldContinue(1, 1, 5)).toBe(false);
    expect(shouldContinue(0, 1, 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldContinue — Normal continuation
// ---------------------------------------------------------------------------

describe("shouldContinue — normal continuation", () => {
  it("returns true when passes remain and work is available", () => {
    expect(shouldContinue(0, 10, 3)).toBe(true);
  });

  it("returns true with a large unblockedSet and many passes remaining", () => {
    expect(shouldContinue(2, 100, 50)).toBe(true);
  });

  it("returns true even when only one task is in the Unblocked Set", () => {
    expect(shouldContinue(0, 5, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldContinue — ADR-0004: NO no-progress guard
//
// A Pass that merged zero tasks must NOT cause the Loop to stop.
// shouldContinue has no concept of merge count — it only cares about
// unblockedSetSize and passesCompleted. These tests guard that design
// invariant explicitly.
// ---------------------------------------------------------------------------

describe("shouldContinue — ADR-0004: zero-merge Pass does not stop the Loop", () => {
  it("continues after a Pass that merged nothing (work still available)", () => {
    // Simulate: Pass 1 completed, 0 merges occurred, but 3 tasks are still ready.
    // The Loop must continue — a zero-merge Pass is NOT a stop signal.
    const passesCompleted = 1;
    const zeroMergesThisPass = 0; // not passed to shouldContinue — by design
    const unblockedSetSize = 3;
    void zeroMergesThisPass; // explicitly unused to document the invariant
    expect(shouldContinue(passesCompleted, 10, unblockedSetSize)).toBe(true);
  });

  it("continues across multiple consecutive zero-merge Passes", () => {
    // Five Passes, none merged anything — Loop must keep going while work exists.
    for (let pass = 0; pass < 5; pass++) {
      expect(shouldContinue(pass, 10, 2)).toBe(true);
    }
  });

  it("shouldContinue signature has no merge-count parameter — enforces ADR-0004 structurally", () => {
    // shouldContinue(passesCompleted, maxPasses, unblockedSetSize) — 3 params only.
    // The function's arity is the compile-time guarantee that progress cannot be
    // checked. If someone adds a 4th param for merge count, this test should be
    // updated to reflect the new design decision.
    expect(shouldContinue.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// shouldContinue — A Task unblocked by a merge is selectable next Pass
//
// This test models a two-Pass sequence to verify the Loop structure enables
// Resumption of newly-unblocked Tasks:
//   Pass 1: unblockedSet = [Task A]  → shouldContinue → true → A gets executed/merged
//   Pass 2: unblockedSet = [Task B]  → shouldContinue → true → B (was blocked by A) runs
//   Pass 3: unblockedSet = []        → shouldContinue → false → Loop ends
// ---------------------------------------------------------------------------

describe("shouldContinue — Task unblocked by a merge is selectable next Pass", () => {
  it("models a two-Pass sequence where task B is unblocked after task A merges", () => {
    // Pass 1: Task A is in the Unblocked Set.
    const afterPass0 = shouldContinue(0, 10, 1); // 1 task (A)
    expect(afterPass0).toBe(true);

    // After Pass 1 completes A is merged. The work source now returns Task B
    // (previously blocked by A) as ready. unblockedSetSize = 1.
    const afterPass1 = shouldContinue(1, 10, 1); // 1 task (B, now unblocked)
    expect(afterPass1).toBe(true);

    // After Pass 2, B is also merged. No more ready tasks.
    const afterPass2 = shouldContinue(2, 10, 0); // empty
    expect(afterPass2).toBe(false);
  });
});
