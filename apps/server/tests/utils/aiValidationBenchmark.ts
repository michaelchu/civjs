import type { AIValidationMetricPoint } from './aiValidation';

export interface AIValidationBenchmarkScore {
  population: number;
  production: number;
  science: number;
  units: number;
  technologies: number;
  decisions: number;
  total: number;
}

/** Strategy-neutral terminal score used for paired, swapped-position matches. */
export function scoreAIValidationPlayer(
  points: AIValidationMetricPoint[],
  playerId: string
): AIValidationBenchmarkScore {
  const terminal = points.at(-1)?.players.find(player => player.id === playerId);
  if (!terminal) throw new Error(`No benchmark metrics for player ${playerId}`);
  const score = {
    population: terminal.population,
    production: terminal.production,
    science: terminal.science,
    units: terminal.units,
    technologies: terminal.technologies,
    decisions: points.reduce(
      (total, point) =>
        total + (point.players.find(player => player.id === playerId)?.decisions ?? 0),
      0
    ),
  };
  return {
    ...score,
    total:
      score.population * 4 +
      score.production * 3 +
      score.science * 3 +
      score.units * 2 +
      score.technologies * 8,
  };
}

export function pairedBenchmarkWinner(
  scores: AIValidationBenchmarkScore[]
): 'first' | 'second' | 'tie' {
  if (scores.length !== 2) throw new Error('Paired benchmark requires exactly two scores');
  if (scores[0]!.total === scores[1]!.total) return 'tie';
  return scores[0]!.total > scores[1]!.total ? 'first' : 'second';
}
