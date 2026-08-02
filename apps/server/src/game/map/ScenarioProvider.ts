/**
 * @module server/game/map/ScenarioProvider
 * Implements Scenario Provider map behavior.
 */
import type { PlayerState } from '@game/runtime/GameTypes';
import type { MapData } from './MapTypes';

export const SCENARIOS_NOT_ENABLED = 'SCENARIOS_NOT_ENABLED';
export const SCENARIOS_NOT_ENABLED_MESSAGE =
  'Scenario games are only enabled for headless simulation runs';

export interface ScenarioMetadata {
  id: string;
  name: string;
  authors?: string;
  description?: string;
  ruleset: string;
}

export interface LoadedScenario {
  mapData: MapData;
  metadata: ScenarioMetadata;
}

export interface ScenarioProvider {
  listScenarios(): readonly string[];
  loadScenario(id: string, players: Map<string, PlayerState>): LoadedScenario;
}

export class ScenarioUnavailableError extends Error {
  readonly code = SCENARIOS_NOT_ENABLED;

  constructor() {
    super(SCENARIOS_NOT_ENABLED_MESSAGE);
    this.name = 'ScenarioUnavailableError';
  }
}

/** Default provider for live games; headless simulation installs a real scenario loader. */
export class DisabledScenarioProvider implements ScenarioProvider {
  listScenarios(): readonly string[] {
    return [];
  }

  loadScenario(_id: string, _players: Map<string, PlayerState>): LoadedScenario {
    throw new ScenarioUnavailableError();
  }
}
