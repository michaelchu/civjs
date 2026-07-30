export interface PlayerScoreInputs {
  cities?: Array<{ population?: number; size?: number }>;
  units?: unknown[];
  researchedTechs?: unknown[];
  history?: number;
}

/**
 * Keep the HUD score and end-game score inputs consistent until score is
 * persisted as part of turn processing.
 */
export function calculatePlayerScore({
  cities = [],
  units = [],
  researchedTechs = [],
  history = 0,
}: PlayerScoreInputs): number {
  return (
    cities.length * 100 +
    cities.reduce((total, city) => total + (city.population ?? city.size ?? 0), 0) * 10 +
    units.length * 20 +
    researchedTechs.length * 50 +
    history
  );
}

export function resolvePlayerScore(persistedScore: unknown, inputs?: PlayerScoreInputs): number {
  if (inputs) return calculatePlayerScore(inputs);
  return typeof persistedScore === 'number' && Number.isFinite(persistedScore) ? persistedScore : 0;
}
