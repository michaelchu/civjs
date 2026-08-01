import { parseArguments } from '../../src/scripts/run-headless-simulation';

describe('headless simulation CLI arguments', () => {
  it('parses the documented deterministic run options', () => {
    expect(
      parseArguments([
        '--config',
        './simulation.json',
        '--seed',
        '424242',
        '--map-seed',
        'map-424242',
        '--max-turns',
        '100',
        '--output',
        './artifacts/run',
        '--jsonl',
        '--timeout-ms',
        '5000',
        '--database-url',
        'postgresql://localhost/civjs_test',
        '--no-persist',
      ])
    ).toEqual({
      configPath: './simulation.json',
      seed: 424242,
      mapSeed: 'map-424242',
      maxTurns: 100,
      outputDirectory: './artifacts/run',
      jsonl: true,
      timeoutMs: 5000,
      databaseUrl: 'postgresql://localhost/civjs_test',
      noPersist: true,
    });
  });

  it('rejects ambiguous or missing CLI inputs', () => {
    expect(() => parseArguments([])).toThrow('--config is required');
    expect(() => parseArguments(['--config', 'simulation.json'])).toThrow('--output is required');
    expect(() =>
      parseArguments(['--config', 'simulation.json', '--output', 'out', '--seed', '-1'])
    ).toThrow('--seed must be an unsigned 32-bit integer');
  });
});
