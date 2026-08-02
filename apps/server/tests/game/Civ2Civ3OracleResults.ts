import { readFileSync } from 'node:fs';

export const CIV2CIV3_ORACLE_BASELINE = {
  version: '3.3.90.5-dev',
  commit: '440b3c9650d3052792296868cb15591bd40612ea',
} as const;

export interface Civ2Civ3OracleResults {
  baseline: {
    version: string;
    commit: string;
  };
  results: Record<string, number>;
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readOracleResultBundle(resultPath: string): unknown {
  try {
    return JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read the Civ2Civ3 oracle result bundle at '${resultPath}': ${detail}`
    );
  }
}

function readBaseline(value: unknown): Civ2Civ3OracleResults['baseline'] {
  if (
    !isJsonRecord(value) ||
    typeof value.version !== 'string' ||
    typeof value.commit !== 'string'
  ) {
    throw new Error('The Civ2Civ3 oracle result bundle has an invalid baseline.');
  }

  return { version: value.version, commit: value.commit };
}

function readResults(value: unknown): Record<string, number> {
  if (!isJsonRecord(value) || !Object.values(value).every(isFiniteNumber)) {
    throw new Error('The Civ2Civ3 oracle result bundle has invalid results.');
  }

  return value as Record<string, number>;
}

/**
 * Load the single Freeciv result bundle prepared before Jest starts.
 *
 * Differential tests intentionally do not start a Freeciv process themselves:
 * that would turn every assertion into a native-server startup. CI invokes the
 * oracle runner once for all scenarios, then makes its immutable JSON output
 * available to each test through FREECIV_ORACLE_RESULTS.
 */
export function loadCiv2Civ3OracleResults(): Civ2Civ3OracleResults | undefined {
  const resultPath = process.env.FREECIV_ORACLE_RESULTS;
  if (!resultPath) return undefined;

  const parsed = readOracleResultBundle(resultPath);
  if (!isJsonRecord(parsed)) {
    throw new Error('The Civ2Civ3 oracle result bundle must be a JSON object.');
  }

  return { baseline: readBaseline(parsed.baseline), results: readResults(parsed.results) };
}
