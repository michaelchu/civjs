import { useGameStore } from '../store/gameStore';
import type { GovernmentState } from '../types';

type SocketRequest = <T>(event: string, data: unknown) => Promise<T>;

export interface AdvisorRecommendations {
  playerId: string;
  turn: number;
  economy: {
    reserve: number;
    rates: { tax: number; luxury: number; science: number };
    rushCityIds: string[];
    saleCandidates: Array<{ cityId: string; buildingId: string }>;
  };
  research: Array<{ technologyId: string; want: number; reason: string; goalId?: string }>;
  cities: Array<{
    cityId: string;
    danger: number;
    urgency: number;
    production: Array<{ kind: 'unit' | 'building'; id: string; want: number; reason: string }>;
  }>;
  workers: Array<{ unitId: string; x: number; y: number; action: string; want: number }>;
  exploration: Array<{ unitId: string; x: number; y: number; want: number }>;
  military: Array<{ unitId: string; targetUnitId: string; want: number; distance: number }>;
}

export class RuntimeControlClientApi {
  constructor(private readonly request: SocketRequest) {}

  async getGovernmentState(): Promise<GovernmentState> {
    const response = await this.request<{
      success: boolean;
      state?: GovernmentState;
      error?: string;
    }>('government:getState', {});
    if (!response.success || !response.state) {
      throw new Error(response.error || 'Failed to load government state');
    }
    this.applyGovernmentState(response.state);
    return response.state;
  }

  async startRevolution(governmentId: string): Promise<string> {
    const response = await this.request<{
      success: boolean;
      state?: GovernmentState;
      message?: string;
      error?: string;
    }>('government:startRevolution', { governmentId });
    if (!response.success || !response.state) {
      throw new Error(response.error || 'Failed to start revolution');
    }
    this.applyGovernmentState(response.state);
    return response.message || 'Revolution started';
  }

  async getTaxRates(): Promise<{ tax: number; luxury: number; science: number }> {
    const response = await this.request<{
      success: boolean;
      rates?: { tax: number; luxury: number; science: number };
      error?: string;
    }>('economy:getTaxRates', {});
    if (!response.success || !response.rates) {
      throw new Error(response.error || 'Failed to load tax rates');
    }
    return response.rates;
  }

  async setTaxRates(rates: {
    tax: number;
    luxury: number;
    science: number;
  }): Promise<{ tax: number; luxury: number; science: number }> {
    const response = await this.request<{
      success: boolean;
      rates?: { tax: number; luxury: number; science: number };
      error?: string;
    }>('economy:setTaxRates', rates);
    if (!response.success || !response.rates) {
      throw new Error(response.error || 'Failed to update tax rates');
    }
    return response.rates;
  }

  async getHostControls(): Promise<{ isHost: boolean; paused: boolean; turnTimeLimit: number }> {
    const response = await this.request<{
      success: boolean;
      isHost: boolean;
      paused: boolean;
      turnTimeLimit: number;
      error?: string;
    }>('host:getControls', {});
    if (!response.success) throw new Error(response.error || 'Failed to load host controls');
    return response;
  }

  async setGamePaused(paused: boolean): Promise<void> {
    await this.requireSuccess('host:setPaused', { paused }, 'update game state');
  }

  async setTurnTimeLimit(turnTimeLimit: number): Promise<void> {
    await this.requireSuccess('host:setTurnTimeLimit', { turnTimeLimit }, 'update turn timer');
  }

  async setPlayerAIControl(
    playerId: string,
    isAI: boolean,
    options: { aiLevel?: string; controllerUserId?: string } = {}
  ): Promise<void> {
    await this.requireSuccess(
      'host:setPlayerAIControl',
      { playerId, isAI, ...options },
      'transfer player control'
    );
  }

  async getAdvisorRecommendations(): Promise<AdvisorRecommendations> {
    const response = await this.request<{
      success: boolean;
      recommendations?: AdvisorRecommendations;
      error?: string;
    }>('advisor:getRecommendations', {});
    if (!response.success || !response.recommendations) {
      throw new Error(response.error || 'Failed to load advisor recommendations');
    }
    return response.recommendations;
  }

  private async requireSuccess(event: string, data: unknown, action: string): Promise<void> {
    const response = await this.request<{ success: boolean; error?: string }>(event, data);
    if (!response.success) throw new Error(response.error || `Failed to ${action}`);
  }

  private applyGovernmentState(state: GovernmentState): void {
    const store = useGameStore.getState();
    const player = store.players[store.currentPlayerId];
    store.updateGameState({
      governments: state.governments,
      players: player
        ? {
            ...store.players,
            [player.id]: {
              ...player,
              government: state.currentGovernment || player.government,
              revolutionTurns: state.revolutionTurns,
            },
          }
        : store.players,
    });
  }
}
