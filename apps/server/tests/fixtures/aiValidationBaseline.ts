/**
 * Conservative regression floor for deterministic AI matrix runs. These are
 * intentionally strategy-neutral; tighten them only after a larger scheduled
 * sample has established stable expectations.
 */
export const aiValidationBaseline = {
  minimumTurnSamples: 3,
  minimumTotalDecisions: 1,
  maximumConsecutiveIdleDecisionTurns: 6,
} as const;
