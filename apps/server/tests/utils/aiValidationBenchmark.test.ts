import { pairedBenchmarkWinner, scoreAIValidationPlayer } from './aiValidationBenchmark';

describe('AI validation benchmark scorer', () => {
  const points = [
    { turn: 2, players: [{ id: 'hard', cities: 1, population: 2, production: 2, trade: 1, science: 1, units: 2, technologies: 0, tasks: 1, decisions: 3 }, { id: 'easy', cities: 1, population: 1, production: 1, trade: 1, science: 0, units: 1, technologies: 0, tasks: 0, decisions: 1 }] },
    { turn: 3, players: [{ id: 'hard', cities: 2, population: 4, production: 5, trade: 3, science: 3, units: 4, technologies: 1, tasks: 2, decisions: 4 }, { id: 'easy', cities: 1, population: 2, production: 2, trade: 2, science: 1, units: 2, technologies: 0, tasks: 0, decisions: 2 }] },
  ];

  it('scores terminal economy and science while retaining activity diagnostics', () => {
    const hard = scoreAIValidationPlayer(points, 'hard');
    const easy = scoreAIValidationPlayer(points, 'easy');
    expect(hard.decisions).toBe(7);
    expect(hard.total).toBeGreaterThan(easy.total);
    expect(pairedBenchmarkWinner([hard, easy])).toBe('first');
  });
});
