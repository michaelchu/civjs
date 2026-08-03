/**
 * Frozen deterministic paired-match result for the strategic regression
 * gate. The current values include the corrected distinction between city
 * founders and dedicated terrain workers; update deliberately only after
 * reviewing the saved match configuration and corresponding decision traces.
 */
export const aiPairedBenchmarkBaseline = {
  mapSeed: 'ai-paired-benchmark-01',
  maxTurns: 12,
  seedCount: 3,
  hardTotal: 266,
  easyTotal: 266,
  hardWins: 0,
} as const;
