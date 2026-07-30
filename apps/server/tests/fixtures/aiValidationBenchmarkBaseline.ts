/**
 * Frozen deterministic paired-match result for the initial strategic
 * regression gate. Update deliberately only after reviewing the saved match
 * configuration and the corresponding decision traces.
 */
export const aiPairedBenchmarkBaseline = {
  mapSeed: 'ai-paired-benchmark-01',
  maxTurns: 12,
  seedCount: 3,
  hardTotal: 110,
  easyTotal: 98,
  hardWins: 2,
} as const;
