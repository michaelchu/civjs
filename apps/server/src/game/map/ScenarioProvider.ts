import type { PlayerState } from '@game/managers/GameManager';
import type { MapData } from './MapTypes';

export const SCENARIOS_NOT_ENABLED = 'SCENARIOS_NOT_ENABLED';
export const SCENARIOS_NOT_ENABLED_MESSAGE = 'Scenario games are not enabled in this release';

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

/** Default provider while scenario gameplay remains outside the supported release scope. */
export class DisabledScenarioProvider implements ScenarioProvider {
  listScenarios(): readonly string[] {
    return [];
  }

  loadScenario(_id: string, _players: Map<string, PlayerState>): LoadedScenario {
    throw new ScenarioUnavailableError();
  }
}
