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

export interface PlayerScoreBreakdown {
  population: number;
  technologies: number;
  wonders: number;
  spaceship: number;
  unitsBuilt: number;
  unitsKilled: number;
  culture: number;
  total: number;
}

/**
 * Keep the HUD score and end-game score inputs consistent until score is
 * persisted as part of turn processing.
 */
export function calculatePlayerScoreBreakdown({
  cities = [],
  units: _units = [],
  researchedTechs = [],
  history = 0,
  greatWonders = 0,
  unitsBuilt = 0,
  unitsKilled = 0,
  spaceship,
  currentTurn = 0,
}: PlayerScoreInputs): PlayerScoreBreakdown {
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

  const breakdown = {
    population: citizens,
    technologies: adjustedTechs * 2,
    wonders: greatWonders * 5,
    spaceship: spaceshipScore,
    unitsBuilt: Math.floor(Math.max(0, unitsBuilt) / 10),
    unitsKilled: Math.floor(Math.max(0, unitsKilled) / 3),
    culture: Math.floor(Math.max(0, history) / 50),
  };
  return { ...breakdown, total: Object.values(breakdown).reduce((sum, value) => sum + value, 0) };
}

export function calculatePlayerScore(inputs: PlayerScoreInputs): number {
  return calculatePlayerScoreBreakdown(inputs).total;
}

export function resolvePlayerScore(persistedScore: unknown, inputs?: PlayerScoreInputs): number {
  if (inputs) return calculatePlayerScore(inputs);
  return typeof persistedScore === 'number' && Number.isFinite(persistedScore) ? persistedScore : 0;
}
