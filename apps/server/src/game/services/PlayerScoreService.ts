export interface PlayerScoreInputs {
  cities?: Array<{
    population?: number;
    size?: number;
    buildings?: string[];
    specialists?: Record<string, number>;
  }>;
  units?: unknown[];
  researchedTechs?: unknown[];
  history?: number;
  greatWonders?: number;
  unitsBuilt?: number;
  unitsKilled?: number;
  spaceship?: {
    arrivalTurn?: number;
    population?: number;
    successRate?: number;
  };
  currentTurn?: number;
}

/**
 * Keep the HUD score and end-game score inputs consistent until score is
 * persisted as part of turn processing.
 */
export function calculatePlayerScore({
  cities = [],
  units: _units = [],
  researchedTechs = [],
  history = 0,
  greatWonders = 0,
  unitsBuilt = 0,
  unitsKilled = 0,
  spaceship,
  currentTurn = 0,
}: PlayerScoreInputs): number {
  const citizens = cities.reduce((total, city) => total + (city.population ?? city.size ?? 0), 0);
  const futureTechs = researchedTechs.filter(technology =>
    String(technology).toLowerCase().includes('future')
  ).length;
  const regularTechs = researchedTechs.length - futureTechs;
  const adjustedTechs = regularTechs + Math.floor((futureTechs * 5) / 2);
  const spaceshipScore =
    spaceship?.arrivalTurn !== undefined && spaceship.arrivalTurn <= currentTurn
      ? Math.floor(((spaceship.population ?? 0) * (spaceship.successRate ?? 100)) / 100)
      : 0;

  return (
    citizens +
    adjustedTechs * 2 +
    greatWonders * 5 +
    spaceshipScore +
    Math.floor(Math.max(0, unitsBuilt) / 10) +
    Math.floor(Math.max(0, unitsKilled) / 3) +
    Math.floor(Math.max(0, history) / 50)
  );
}

export function resolvePlayerScore(persistedScore: unknown, inputs?: PlayerScoreInputs): number {
  if (inputs) return calculatePlayerScore(inputs);
  return typeof persistedScore === 'number' && Number.isFinite(persistedScore) ? persistedScore : 0;
}
