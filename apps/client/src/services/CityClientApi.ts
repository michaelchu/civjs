/**
 * @module client/services/CityClientApi
 * Provides the client-side City Client Api service.
 */
import type { Socket } from 'socket.io-client';
import { useGameStore } from '../store/gameStore';
import type { City, CityBatchAction, CityBatchResult, ProductionOption } from '../types';
import { PacketType } from '../types/packets';

type PacketRequest = (
  requestType: PacketType,
  replyType: PacketType,
  data: unknown,
  isSuccess: (data: Record<string, unknown>) => boolean,
  fallbackError: string,
  matchesReply?: (data: Record<string, unknown>) => boolean
) => Promise<Record<string, unknown>>;

type SocketRequest = <T>(event: string, data: unknown) => Promise<T>;

export class CityClientApi {
  constructor(
    private readonly getSocket: () => Socket | null,
    private readonly requestPacket: PacketRequest,
    private readonly requestSocketEvent: SocketRequest
  ) {}

  async getAvailableProductions(cityId: string): Promise<ProductionOption[]> {
    return new Promise((resolve, reject) => {
      const socket = this.getSocket();
      if (!socket) return reject(new Error('Not connected to server'));
      const cleanup = () => {
        socket.off('city:availableProductions', handleResponse);
        socket.off('error', handleError);
        clearTimeout(timeout);
      };
      const handleResponse = (data: { cityId: string; productions: ProductionOption[] }) => {
        if (data.cityId !== cityId) return;
        cleanup();
        resolve(data.productions);
      };
      const handleError = (error: { message: string }) => {
        cleanup();
        reject(new Error(error.message));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Get available productions timeout'));
      }, 10000);
      socket.on('city:availableProductions', handleResponse);
      socket.on('error', handleError);
      socket.emit('city:getAvailableProductions', { cityId });
    });
  }

  async changeProduction(
    cityId: string,
    productionId: string,
    productionType: 'unit' | 'building' | 'wonder'
  ): Promise<void> {
    const data = await this.requestPacket(
      PacketType.CITY_PRODUCTION_CHANGE,
      PacketType.CITY_PRODUCTION_CHANGE_REPLY,
      { cityId, production: productionId, type: productionType },
      reply => Boolean(reply.success),
      'Failed to change production',
      reply => reply.cityId === cityId
    );
    const { cities } = useGameStore.getState();
    if (cities[cityId] && data.production) {
      useGameStore.getState().updateGameState({
        cities: {
          ...cities,
          [cityId]: { ...cities[cityId], production: data.production as City['production'] },
        },
      });
    }
  }

  async configureGovernor(
    cityId: string,
    config: {
      enabled: boolean;
      priority: string;
      autoManageSpecialists: boolean;
      autoManageTiles: boolean;
      autoManageProduction: boolean;
      preventStarvation: boolean;
      maintainHappiness: boolean;
    }
  ): Promise<void> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      governor?: City['governor'];
      error?: string;
    }>('city:configureGovernor', { cityId, ...config });
    if (!response.success) throw new Error(response.error || 'Failed to configure governor');
    const { cities } = useGameStore.getState();
    if (cities[cityId] && response.governor) {
      useGameStore.getState().updateGameState({
        cities: {
          ...cities,
          [cityId]: { ...cities[cityId], governor: response.governor },
        },
      });
    }
  }

  async setRallyPoint(
    cityId: string,
    rallyPoint: { x: number; y: number; persistent: boolean } | null
  ): Promise<void> {
    await this.requireSuccess('city:setRallyPoint', { cityId, rallyPoint }, 'set rally point');
  }

  async optimizeCitizens(cityId: string): Promise<void> {
    await this.requireSuccess('city:optimizeCitizens', { cityId }, 'optimize citizens');
  }

  async batchManage(cityIds: string[], action: CityBatchAction): Promise<CityBatchResult> {
    const response = await this.requestSocketEvent<CityBatchResult>('city:batchManage', {
      cityIds,
      ...action,
    });
    if (response.error && response.succeeded.length === 0) throw new Error(response.error);
    if (response.treasury) this.updateCurrentPlayerGold(response.treasury.after);
    return response;
  }

  async buyProduction(cityId: string): Promise<{
    goldSpent: number;
    completed: boolean;
    remainingGold?: number;
  }> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      result?: { goldSpent: number; completed: boolean; remainingGold?: number };
      error?: string;
    }>('city:buyProduction', { cityId });
    if (!response.success || !response.result) {
      throw new Error(response.error || 'Failed to buy production');
    }
    if (response.result.remainingGold !== undefined) {
      this.updateCurrentPlayerGold(response.result.remainingGold);
    }
    return response.result;
  }

  async addWorklistItem(
    cityId: string,
    productionId: string,
    type: 'unit' | 'building' | 'wonder'
  ): Promise<void> {
    await this.requireSuccess(
      'city:addWorklist',
      { cityId, items: [{ productionId, type }] },
      'add worklist item'
    );
  }

  async removeWorklistItem(cityId: string, index: number): Promise<void> {
    await this.requireSuccess('city:removeWorklist', { cityId, index }, 'remove worklist item');
  }

  async reorderWorklist(cityId: string, fromIndex: number, toIndex: number): Promise<void> {
    await this.requireSuccess(
      'city:reorderWorklist',
      { cityId, fromIndex, toIndex },
      'reorder worklist'
    );
  }

  async assignCitizen(cityId: string, x: number, y: number): Promise<void> {
    await this.requireSuccess('city:assignCitizen', { cityId, x, y }, 'assign citizen');
  }

  async workerToSpecialist(
    cityId: string,
    x: number,
    y: number,
    specialistType: number
  ): Promise<void> {
    await this.requireSuccess(
      'city:workerToSpecialist',
      { cityId, x, y, specialistType },
      'create specialist'
    );
  }

  async specialistToTile(
    cityId: string,
    specialistType: number,
    x: number,
    y: number
  ): Promise<void> {
    await this.requireSuccess(
      'city:specialistToTile',
      { cityId, specialistType, x, y },
      'assign specialist'
    );
  }

  async changeSpecialist(cityId: string, fromType: number, toType: number): Promise<void> {
    await this.requireSuccess(
      'city:changeSpecialist',
      { cityId, fromType, toType },
      'change specialist'
    );
  }

  async rename(cityId: string, name: string): Promise<void> {
    await this.requireSuccess('city:rename', { cityId, name }, 'rename city');
  }

  async sellBuilding(
    cityId: string,
    buildingId: string
  ): Promise<{ goldReceived: number; remainingGold?: number }> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      goldReceived?: number;
      remainingGold?: number;
      error?: string;
    }>('city:sellBuilding', { cityId, buildingId });
    if (!response.success) throw new Error(response.error || 'Failed to sell building');
    if (response.remainingGold !== undefined) this.updateCurrentPlayerGold(response.remainingGold);
    return { goldReceived: response.goldReceived ?? 0, remainingGold: response.remainingGold };
  }

  async disband(cityId: string): Promise<void> {
    await this.requireSuccess('city:disband', { cityId }, 'disband city');
  }

  private async requireSuccess(event: string, data: unknown, action: string): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      event,
      data
    );
    if (!response.success) throw new Error(response.error || `Failed to ${action}`);
  }

  private updateCurrentPlayerGold(gold: number): void {
    const store = useGameStore.getState();
    const player = store.players[store.currentPlayerId];
    if (!player) return;
    store.updateGameState({
      players: { ...store.players, [player.id]: { ...player, gold } },
    });
  }
}
