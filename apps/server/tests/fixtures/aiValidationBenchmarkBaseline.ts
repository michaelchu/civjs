/**
 * Frozen deterministic paired-match result for the initial strategic
 * regression gate. Update deliberately only after reviewing the saved match
 * configuration and the corresponding decision traces.
 */
export const aiPairedBenchmarkBaseline = {
  mapSeed: 'ai-paired-benchmark-01',
  maxTurns: 4,
  hardTotal: 24,
  easyTotal: 22,
} as const;
