/**
 * Frozen deterministic paired-match result for the strategic regression
 * gate. The current values include the reviewed C2C3 runtime-effect and
 * movement-recovery behavior; update deliberately only after reviewing the
 * saved match configuration and corresponding decision traces.
 */
export const aiPairedBenchmarkBaseline = {
  mapSeed: 'ai-paired-benchmark-01',
  maxTurns: 12,
  seedCount: 3,
  hardTotal: 247,
  easyTotal: 239,
  hardWins: 2,
} as const;
