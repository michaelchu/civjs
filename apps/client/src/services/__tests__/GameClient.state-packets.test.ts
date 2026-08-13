import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { PacketType, type Packet } from '../../types/packets';

const handlePacket = (packet: Packet) =>
  (
    gameClient as unknown as {
      handlePacket: (incoming: Packet) => void;
    }
  ).handlePacket(packet);
const applyCultureUpdate = (data: {
  players: Record<string, { history: number; totalCulture: number }>;
}) =>
  (
    gameClient as unknown as {
      applyCultureUpdate: (incoming: typeof data) => void;
    }
  ).applyCultureUpdate(data);

describe('GameClient state-bearing packets', () => {
  beforeEach(() => {
    useGameStore.getState().updateGameState({
      turn: 0,
      year: undefined,
      players: {},
      cities: {},
      units: {},
      map: { width: 0, height: 0, tiles: {} },
    });
    useGameStore.setState({
      notifications: [],
      hasReceivedUnitSnapshot: false,
      presentationEffects: [],
    });
    useGameStore.setState({ clientState: 'running', endGameReport: undefined });
  });

  it('keeps distinct server combat events on the same tile and deduplicates repeated event IDs', () => {
    const socket = { on: vi.fn() };
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
    (gameClient as unknown as { setupGameHandlers: () => void }).setupGameHandlers();

    const combatHandler = socket.on.mock.calls.find(
      ([event]) => event === 'combat_occurred'
    )?.[1] as
      | ((data: {
          eventId: string;
          x: number;
          y: number;
          combatants?: Array<Record<string, unknown>>;
        }) => void)
      | undefined;
    expect(combatHandler).toBeDefined();

    vi.spyOn(performance, 'now').mockReturnValue(1000);
    combatHandler!({ eventId: 'combat-1', x: 3, y: 4 });
    combatHandler!({
      eventId: 'combat-2',
      x: 3,
      y: 4,
      combatants: [
        {
          id: 'defender-1',
          role: 'defender',
          playerId: 'player-2',
          unitTypeId: 'warriors',
          x: 3,
          y: 4,
          hpBefore: 100,
          hpAfter: 0,
          destroyed: true,
        },
      ],
    });
    combatHandler!({ eventId: 'combat-1', x: 3, y: 4 });

    expect(useGameStore.getState().presentationEffects).toHaveLength(2);
    expect(useGameStore.getState().presentationEffects?.map(effect => effect.id)).toEqual([
      'combat-1',
      'combat-2',
    ]);

    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 2, wrap_id: 0 },
    });
    expect(useGameStore.getState().presentationEffects).toEqual([]);
    vi.restoreAllMocks();
  });

  it('correlates a local attack reply with its rich server combat broadcast', () => {
    const socket = { on: vi.fn() };
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
    (gameClient as unknown as { setupGameHandlers: () => void }).setupGameHandlers();

    const combatHandler = socket.on.mock.calls.find(
      ([event]) => event === 'combat_occurred'
    )?.[1] as ((data: Record<string, unknown>) => void) | undefined;
    expect(combatHandler).toBeDefined();

    useGameStore.getState().updateGameState({
      units: {
        defender: {
          id: 'defender',
          playerId: 'player-2',
          unitTypeId: 'warriors',
          x: 3,
          y: 4,
          hp: 20,
          movesLeft: 1,
          veteranLevel: 0,
        },
      },
    });
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    combatHandler!({
      eventId: 'combat-rich',
      x: 3,
      y: 4,
      combatants: [
        {
          id: 'attacker',
          role: 'attacker',
          playerId: 'player-1',
          unitTypeId: 'warriors',
          x: 2,
          y: 4,
          hpBefore: 100,
          hpAfter: 80,
          destroyed: false,
        },
        {
          id: 'defender',
          role: 'defender',
          playerId: 'player-2',
          unitTypeId: 'warriors',
          x: 3,
          y: 4,
          hpBefore: 100,
          hpAfter: 20,
          destroyed: false,
        },
      ],
    });
    handlePacket({
      type: PacketType.UNIT_ATTACK_REPLY,
      data: {
        success: true,
        combatResult: { attackerId: 'attacker', defenderId: 'defender' },
      },
    } as Packet);

    expect(useGameStore.getState().presentationEffects).toHaveLength(1);
    expect(useGameStore.getState().presentationEffects?.[0]).toEqual(
      expect.objectContaining({
        id: 'combat-rich',
        origin: 'correlated',
        combatants: expect.arrayContaining([
          expect.objectContaining({ id: 'attacker' }),
          expect.objectContaining({ id: 'defender' }),
        ]),
      })
    );
    vi.restoreAllMocks();
  });

  it('removes a consumed settler when the server broadcasts unit destruction', () => {
    const socket = { on: vi.fn() };
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
    (gameClient as unknown as { setupGameHandlers: () => void }).setupGameHandlers();

    useGameStore.getState().updateGameState({
      units: {
        'settler-1': {
          id: 'settler-1',
          playerId: 'player-1',
          unitTypeId: 'settlers',
          x: 11,
          y: 13,
          hp: 100,
          movesLeft: 0,
          veteranLevel: 0,
        },
      },
    });

    const destructionHandler = socket.on.mock.calls.find(
      ([event]) => event === 'unit_destroyed'
    )?.[1] as ((data: { unitId: string }) => void) | undefined;
    expect(destructionHandler).toBeDefined();

    destructionHandler!({ unitId: 'settler-1' });

    expect(useGameStore.getState().units['settler-1']).toBeUndefined();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/movement.h:33-44
   * @assertion Unit snapshots, move replies, and movement broadcasts all keep
   * `SINGLE_MOVE` fragments in the same client `movesLeft` field.
   */
  it('keeps movement fragments consistent across move replies and broadcasts', () => {
    const socket = { on: vi.fn() };
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
    (gameClient as unknown as { setupGameHandlers: () => void }).setupGameHandlers();
    useGameStore.getState().updateGameState({
      units: {
        'unit-1': {
          id: 'unit-1',
          playerId: 'player-1',
          unitTypeId: 'warriors',
          x: 1,
          y: 2,
          hp: 100,
          movesLeft: 18,
          maxMoves: 18,
          veteranLevel: 0,
        },
      },
    });

    handlePacket({
      type: PacketType.UNIT_MOVE_REPLY,
      data: {
        success: true,
        unitId: 'unit-1',
        newX: 2,
        newY: 2,
        movementLeft: 11,
      },
    });
    expect(useGameStore.getState().units['unit-1']).toEqual(
      expect.objectContaining({ x: 2, y: 2, movesLeft: 11 })
    );

    const movedHandler = socket.on.mock.calls.find(([event]) => event === 'unit_moved')?.[1] as
      ((data: { unitId: string; x: number; y: number; movementLeft: number }) => void) | undefined;
    expect(movedHandler).toBeDefined();
    movedHandler!({ unitId: 'unit-1', x: 3, y: 2, movementLeft: 5 });

    expect(useGameStore.getState().units['unit-1']).toEqual(
      expect.objectContaining({ x: 3, y: 2, movesLeft: 5 })
    );
    expect(useGameStore.getState().units['unit-1']).not.toHaveProperty('movementLeft');
  });

  it('applies player, calendar, city, and turn-processing packets', () => {
    handlePacket({
      type: PacketType.PLAYER_INFO,
      data: {
        id: 'player-1',
        name: 'Caesar',
        nation: 'roman',
        color: { r: 255, g: 0, b: 0 },
        gold: 75,
        goldPerTurn: -2,
        science: 12,
        sciencePerTurn: 4,
        taxRate: 40,
        luxuryRate: 10,
        scienceRate: 50,
        score: 275,
        teamId: 'team-1',
        spaceshipState: { structurals: 2 },
        culture: 34,
        government: 'republic',
        alive: true,
        isAI: true,
      },
    });
    handlePacket({ type: PacketType.NEW_YEAR, data: { turn: 5, year: -3840 } });
    handlePacket({
      type: PacketType.CITY_INFO,
      data: { id: 'city-1', name: 'Rome', playerId: 'player-1' },
    });
    handlePacket({ type: PacketType.FREEZE_CLIENT, data: {} });

    expect(useGameStore.getState().players['player-1']).toEqual(
      expect.objectContaining({
        name: 'Caesar',
        government: 'republic',
        gold: 75,
        goldPerTurn: -2,
        science: 12,
        sciencePerTurn: 4,
        history: 0,
        culture: 34,
        color: '#ff0000',
        isHuman: false,
        taxRate: 40,
        luxuryRate: 10,
        scienceRate: 50,
        score: 275,
        teamId: 'team-1',
        spaceshipState: { structurals: 2 },
      })
    );
    expect(useGameStore.getState()).toEqual(expect.objectContaining({ turn: 5, year: -3840 }));
    expect(useGameStore.getState().cities['city-1']).toEqual(
      expect.objectContaining({ name: 'Rome' })
    );
    expect(useGameStore.getState().turnProcessingState).toBe('processing');

    handlePacket({ type: PacketType.THAW_CLIENT, data: {} });
    expect(useGameStore.getState().turnProcessingState).toBe('idle');
  });

  it('clears the optimistic processing state when the server rejects ending the turn', () => {
    useGameStore.getState().startTurnProcessing();

    handlePacket({
      type: PacketType.TURN_END_REPLY,
      data: { success: false, message: 'Database temporarily unavailable' },
    });

    expect(useGameStore.getState().turnProcessingState).toBe('idle');
    expect(useGameStore.getState().turnProcessingSteps).toEqual([]);
    expect(useGameStore.getState().notifications.at(-1)).toMatchObject({
      message: 'Turn processing failed: Database temporarily unavailable',
      tone: 'error',
    });
  });

  it('clears the processing state when a turn phase reports an error', () => {
    useGameStore.getState().startTurnProcessing();

    handlePacket({
      type: PacketType.TURN_PROCESSING_STEP,
      data: {
        step: 'unit_activities',
        label: 'Error in unit activities: database unavailable',
        error: true,
      },
    });

    expect(useGameStore.getState().turnProcessingState).toBe('idle');
    expect(useGameStore.getState().notifications.at(-1)?.tone).toBe('error');
  });

  it('applies map, visibility, extras, and border ownership packets', () => {
    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tile: 0,
        x: 0,
        y: 0,
        terrain: 'grassland',
        known: 2,
        seen: 1,
        improvements: ['road', 'irrigation'],
        owner: 'player-1',
      },
    });
    handlePacket({
      type: PacketType.BORDER_UPDATE,
      data: { tiles: [{ x: 0, y: 0, owner: 'player-2' }] },
    });

    expect(useGameStore.getState().map).toEqual(expect.objectContaining({ width: 2, height: 1 }));
    expect(useGameStore.getState().map.tiles['0,0']).toEqual(
      expect.objectContaining({
        terrain: 'grassland',
        improvements: ['road', 'irrigation'],
        owner: 'player-2',
        visible: true,
        known: true,
      })
    );
  });

  it('preserves HUD-relevant unit metadata during normalization', () => {
    handlePacket({
      type: PacketType.UNIT_INFO,
      data: {
        units: [
          {
            id: 'unit-1',
            owner: 'player-1',
            type: 'warriors',
            x: 2,
            y: 3,
            hp: 80,
            attack: 4,
            defense: 2,
            firepower: 1,
            movesleft: 2,
            maxmoves: 3,
            veteran: 1,
            homeCity: 'city-1',
            nationality: 'roman',
            upkeep: [0, 1, 2],
            activityTarget: 'road',
            occupied: true,
            paradropped: false,
            doneMoving: true,
            stay: true,
            facing: 4,
            birthTurn: 7,
            automation: 'worker',
            automationTask: {
              action: 'build_road',
              targetX: 4,
              targetY: 3,
              assignedTurn: 7,
            },
          },
        ],
      },
    });

    expect(useGameStore.getState().units['unit-1']).toEqual(
      expect.objectContaining({
        homeCityId: 'city-1',
        nationality: 'roman',
        upkeep: { food: 0, shields: 1, gold: 2 },
        activityTarget: 'road',
        occupied: true,
        doneMoving: true,
        stay: true,
        facing: 4,
        birthTurn: 7,
        attack: 4,
        defense: 2,
        firepower: 1,
        automation: 'worker',
        automationTask: expect.objectContaining({ action: 'build_road', targetX: 4 }),
      })
    );
  });

  it('normalizes legacy unit and city field names into HUD models', () => {
    handlePacket({
      type: PacketType.UNIT_INFO,
      data: {
        units: [
          {
            id: 'unit-legacy',
            playerId: 'player-1',
            unitTypeId: 'settlers',
            x: 1,
            y: 2,
            hp: 100,
            movesLeft: 1,
            maxMoves: 2,
            veteranLevel: 0,
            homecity: 'city-legacy',
            activity_target: 'city-legacy',
            done_moving: true,
            birth_turn: 3,
            upkeep: [1, 0, 0],
          },
        ],
      },
    });
    handlePacket({
      type: PacketType.CITY_INFO,
      data: {
        id: 'city-legacy',
        name: 'Rome',
        playerId: 'player-1',
        x: 1,
        y: 2,
        population: 4,
        foodPerTurn: 3,
        productionPerTurn: 5,
        tradePerTurn: 2,
        currentProduction: 'warriors',
        productionType: 'unit',
        productionStock: 6,
        turnsToComplete: 2,
        foundedTurn: 8,
      },
    });

    expect(useGameStore.getState().units['unit-legacy']).toEqual(
      expect.objectContaining({
        homeCityId: 'city-legacy',
        activityTarget: 'city-legacy',
        doneMoving: true,
        birthTurn: 3,
        movesLeft: 1,
      })
    );
    expect(useGameStore.getState().cities['city-legacy']).toEqual(
      expect.objectContaining({
        size: 4,
        food: 3,
        shields: 5,
        trade: 2,
        production: expect.objectContaining({
          target: 'warriors',
          progress: 6,
          turnsToComplete: 2,
        }),
      })
    );
  });

  it('maps Freeciv fog states and replaces stale units with full visibility snapshots', () => {
    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [
          { tile: 0, x: 0, y: 0, terrain: 'plains', known: 1, seen: 0 },
          { tile: 1, x: 1, y: 0, terrain: 'unknown', known: 0, seen: 0 },
        ],
        startIndex: 0,
        endIndex: 2,
        total: 2,
      },
    });
    useGameStore.getState().updateGameState({
      units: {
        stale: {
          id: 'stale',
          playerId: 'enemy',
          unitTypeId: 'warriors',
          x: 1,
          y: 0,
          hp: 100,
          movesLeft: 1,
          veteranLevel: 0,
        },
      },
    });
    handlePacket({
      type: PacketType.UNIT_INFO,
      data: { units: [], fullSnapshot: true },
    });

    expect(useGameStore.getState().map.tiles['0,0']).toEqual(
      expect.objectContaining({ known: true, visible: false })
    );
    expect(useGameStore.getState().map.tiles['1,0']).toEqual(
      expect.objectContaining({ known: false, visible: false })
    );
    expect(useGameStore.getState().units).toEqual({});
    expect(useGameStore.getState().hasReceivedUnitSnapshot).toBe(true);
  });

  it('resets unit snapshot readiness when a new map snapshot begins', () => {
    useGameStore.setState({ hasReceivedUnitSnapshot: true });

    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });

    expect(useGameStore.getState().hasReceivedUnitSnapshot).toBe(false);
  });

  it('does not synthesize resize events after a recovered map snapshot', () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 1, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [{ tile: 0, x: 0, y: 0, terrain: 'plains', known: 2, seen: 1 }],
        startIndex: 0,
        endIndex: 1,
        total: 1,
      },
    });
    vi.runAllTimers();

    expect(dispatchEvent.mock.calls.some(([event]) => event.type === 'resize')).toBe(false);
    dispatchEvent.mockRestore();
    vi.useRealTimers();
  });

  /**
   * @evidence stack
   * @contract The client exposes a recovered map only after receiving every authoritative tile batch.
   */
  it('commits a recovered map only after the final tile batch', () => {
    useGameStore.setState({
      map: {
        width: 1,
        height: 1,
        xsize: 1,
        ysize: 1,
        tiles: {
          '0,0': { x: 0, y: 0, terrain: 'grassland', known: true, visible: true },
        },
      },
    });
    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [{ tile: 0, x: 0, y: 0, terrain: 'plains', known: 2, seen: 1 }],
        startIndex: 0,
        endIndex: 1,
        total: 2,
      },
    });

    expect(useGameStore.getState().map).toEqual(
      expect.objectContaining({
        width: 1,
        tiles: { '0,0': expect.objectContaining({ terrain: 'grassland' }) },
      })
    );

    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [{ tile: 0, x: 0, y: 0, terrain: 'plains', known: 2, seen: 1 }],
        startIndex: 0,
        endIndex: 1,
        total: 1,
        fullSnapshot: false,
      },
    });
    expect(useGameStore.getState().map).toEqual(
      expect.objectContaining({
        width: 1,
        tiles: { '0,0': expect.objectContaining({ terrain: 'plains', visible: true }) },
      })
    );

    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [{ tile: 1, x: 1, y: 0, terrain: 'ocean', known: 2, seen: 1 }],
        startIndex: 1,
        endIndex: 2,
        total: 2,
      },
    });

    expect(useGameStore.getState().map.tiles).toEqual({
      '0,0': expect.objectContaining({ terrain: 'plains', visible: true }),
      '1,0': expect.objectContaining({ terrain: 'ocean' }),
    });
  });

  it('applies authoritative culture updates to existing players', () => {
    handlePacket({
      type: PacketType.PLAYER_INFO,
      data: {
        id: 'player-1',
        name: 'Caesar',
        nation: 'roman',
        color: { r: 255, g: 0, b: 0 },
        gold: 75,
        science: 12,
        culture: 0,
        government: 'republic',
        alive: true,
      },
    });

    applyCultureUpdate({
      players: { 'player-1': { history: 21, totalCulture: 34 } },
    });

    expect(useGameStore.getState().players['player-1']).toEqual(
      expect.objectContaining({ history: 21, culture: 34 })
    );
  });

  it('turns server and territory messages into visible notifications', () => {
    handlePacket({
      type: PacketType.CONNECT_MSG,
      data: { type: 'error', message: 'Connection interrupted' },
    });
    handlePacket({
      type: PacketType.CHAT_MSG,
      data: { type: 'chat', message: 'Ready?' },
    });
    handlePacket({
      type: PacketType.BORDER_CHANGE_NOTIFICATION,
      data: { playerId: 'player-1', tilesGained: [{ x: 1, y: 1 }], tilesLost: [] },
    });

    expect(useGameStore.getState().notifications.map(notification => notification.message)).toEqual(
      ['Connection interrupted', 'Ready?', '1 territory tiles gained']
    );
  });

  it('hydrates diplomacy snapshots and reports rejected diplomacy actions', () => {
    handlePacket({
      type: PacketType.DIPLOMACY_LIST_REPLY,
      data: {
        success: true,
        playerId: 'player-1',
        nations: [
          {
            id: 'player-2',
            civilization: 'greek',
            leaderName: 'Pericles',
            isAlive: true,
            isAI: false,
            known: true,
            relation: {
              state: 'peace',
              sinceTurn: 3,
              embassy: true,
              sharedVision: false,
            },
          },
        ],
      },
    });
    expect(useGameStore.getState().diplomacy?.nations[0]).toEqual(
      expect.objectContaining({
        id: 'player-2',
        relation: expect.objectContaining({ state: 'peace', embassy: true }),
      })
    );

    handlePacket({
      type: PacketType.DIPLOMACY_UPDATE,
      data: { success: false, message: 'Treaty proposal not found' },
    });
    expect(useGameStore.getState().notifications.at(-1)?.message).toBe('Treaty proposal not found');
  });

  it('moves to the accessible end-game flow when the final report arrives', () => {
    handlePacket({
      type: PacketType.ENDGAME_REPORT,
      data: {
        version: 1,
        gameId: 'game-1',
        turn: 42,
        year: -2320,
        reason: 'conquest',
        winnerPlayerId: 'player-1',
        winnerPlayerIds: ['player-1'],
        endedAt: '2026-07-26T12:00:00.000Z',
        standings: [
          {
            playerId: 'player-1',
            civilization: 'Roman',
            score: 400,
            cities: 2,
            population: 8,
            units: 1,
            technologies: 2,
            history: 0,
            alive: true,
          },
        ],
      },
    });

    expect(useGameStore.getState().clientState).toBe('over');
    expect(useGameStore.getState().endGameReport?.winnerPlayerId).toBe('player-1');
  });
});
