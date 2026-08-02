import type { GameInstance } from './GameTypes';
import type { UnitLifecycleEvent } from '@game/units/UnitTypes';

/**
 * Connects domain manager events to telemetry and runtime reactions.
 * Keeping these subscriptions together makes the composition root explicit
 * and prevents managers from depending on the GameManager facade.
 */
export function bindGameRuntimeEvents(
  game: GameInstance,
  onUnitLifecycle: (event: UnitLifecycleEvent) => void
): void {
  const gameEvents = game.turnManager.getGameEventService();

  game.researchManager.setTechnologyCompletionObserver((playerId, techId, source) => {
    gameEvents.recordTechnologyCompleted(playerId, techId, source);
  });
  game.cityManager.setGameplayEventObserver(event => {
    switch (event.type) {
      case 'founded':
        gameEvents.recordCityFounded(event.city);
        break;
      case 'growth':
        gameEvents.recordCityGrowth(event.city, event.oldSize);
        break;
      case 'production_completed':
        gameEvents.recordCityProductionCompleted(event.city, event.item);
        break;
      case 'trade_route_established':
        gameEvents.recordTradeRouteEstablished(event.sourceCity, event.partnerCity, event.route);
        break;
    }
  });
  game.unitManager.setCombatObserver(event => gameEvents.recordCombatOccurred(event));
  game.unitManager.setUnitLifecycleObserver(event => {
    gameEvents.recordUnitLifecycle(event);
    if (event.type === 'moved') {
      game.cityManager.refreshTileOccupancy(event.previousX, event.previousY);
    }
    game.cityManager.refreshTileOccupancy(event.unit.x, event.unit.y);
    if (event.type === 'created' || event.type === 'moved' || event.type === 'owner_changed') {
      void game.unitManager.wakeSentriesForUnit(event.unit);
    }
    onUnitLifecycle(event);
  });
}
