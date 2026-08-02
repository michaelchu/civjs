import {
  exitCodeForError,
  exitCodeForStatus,
  isIsolatedDatabaseTarget,
  parseArguments,
} from '../../src/scripts/run-headless-simulation';
import {
  HEADLESS_EXIT_CODES,
  HeadlessSimulationOutputError,
  exitCodeForBundle,
} from '@game/services/HeadlessSimulationRunner';

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
    expect(() => parseArguments(['--serd'])).toThrow('Unknown option: --serd');
    expect(() =>
      parseArguments(['--config', 'simulation.json', '--output', 'out', '--max-turns'])
    ).toThrow('Missing value for --max-turns');
    expect(() =>
      parseArguments(['--config', 'simulation.json', '--output', 'out', '--max-turns', '0'])
    ).toThrow('--max-turns must be a positive integer');
    expect(() =>
      parseArguments(['--config', 'simulation.json', '--output', 'out', '--map-seed', ' '])
    ).toThrow('--map-seed must not be empty');
  });

  it('matches isolated database markers only in the database name', () => {
    expect(isIsolatedDatabaseTarget('postgresql://localhost/civjs_test')).toBe(true);
    expect(isIsolatedDatabaseTarget('postgresql://localhost/civjs-sandbox')).toBe(true);
    expect(isIsolatedDatabaseTarget('postgresql://tester:secret@db.prod/civjs')).toBe(false);
    expect(isIsolatedDatabaseTarget('not-a-database-url')).toBe(false);
  });

  it('keeps the documented exit-code contract centralized', () => {
    expect(HEADLESS_EXIT_CODES).toEqual({
      completed: 0,
      invalidConfiguration: 2,
      turnFailure: 3,
      timeoutOrCancellation: 4,
      outputFailure: 5,
      expectationFailure: 6,
      invariantFailure: 7,
    });
    expect(exitCodeForStatus('completed')).toBe(0);
    expect(exitCodeForStatus('failed')).toBe(3);
    expect(exitCodeForStatus('timed_out')).toBe(4);
    expect(exitCodeForStatus('cancelled')).toBe(4);
    expect(exitCodeForError(new HeadlessSimulationOutputError('disk full'))).toBe(5);
    expect(exitCodeForError(new Error('unexpected'))).toBe(3);
    expect(
      exitCodeForBundle({
        failure: { code: 'EXPECTATION_FAILED', message: 'war was not declared' },
        result: { status: 'failed' },
      } as any)
    ).toBe(6);
    expect(
      exitCodeForBundle({
        failure: { code: 'INVARIANT_FAILED', message: 'invalid unit position' },
        result: { status: 'failed' },
      } as any)
    ).toBe(7);
  });
});
