/**
 * shouldContinue — the outer Loop termination predicate (Slice 5).
 *
 * Returns true if the Loop should proceed with the next Pass; false to halt.
 *
 * Termination conditions:
 *   1. The Unblocked Set is empty (no work can start this Pass).
 *   2. The number of completed Passes has reached the configured Max Passes.
 *
 * ADR-0004: A zero-merge Pass is NOT a stop condition. Agents routinely fail
 * to commit in a given iteration, and the next Pass (via Resumption) often
 * succeeds where the previous one ran out of budget. A progress guard would
 * defeat the RALPH-style persistence model — do not add one.
 *
 * @param passesCompleted  Number of Passes already run (0 before the first Pass).
 * @param maxPasses        Configured upper bound on total Passes.
 * @param unblockedSetSize Size of the Unblocked Set selected during Plan.
 *                         A value of 0 means nothing is ready to run this Pass.
 */
export function shouldContinue(
  passesCompleted: number,
  maxPasses: number,
  unblockedSetSize: number,
): boolean {
  if (unblockedSetSize === 0) return false;
  if (passesCompleted >= maxPasses) return false;
  return true;
}
