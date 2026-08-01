/**
 * Frozen deterministic paired-match result for the strategic regression
 * gate. The current values include shared worker infrastructure automation;
 * update deliberately only after reviewing the saved match configuration and
 * corresponding decision traces.
 */
export const aiPairedBenchmarkBaseline = {
  mapSeed: 'ai-paired-benchmark-01',
  maxTurns: 12,
  seedCount: 3,
  hardTotal: 177,
  easyTotal: 173,
  hardWins: 2,
} as const;
