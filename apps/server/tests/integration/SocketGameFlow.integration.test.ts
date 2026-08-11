/**
 * Milestone 0 transport smoke test.
 *
 * Verifies the local game flow over a real Socket.IO server rather than by
 * calling managers or handlers directly. The game rules themselves are covered
 * by GameFlow.integration.test.ts.
 */

jest.unmock('socket.io');

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import { SocketCoordinator } from '@network/SocketCoordinator';
import { GameManager } from '@game/managers/GameManager';
import { PacketType, type Packet } from '@app-types/packet';
import { SINGLE_MOVE, getTerrainMovementCost } from '@game/constants/MovementConstants';
import {
  clearAllTables,
  generateTestUUID,
  getTestDatabase,
  getTestDatabaseProvider,
} from '../utils/testDatabase';

// A C2C3 map snapshot includes per-player visibility and can take longer than
// a small unit fixture on a contended CI worker. This only affects failures;
// successful packet exchanges complete immediately.
const timeoutMs = 30_000;

jest.setTimeout(60_000);

function waitForPacket(
  socket: ClientSocket,
  type: PacketType,
  predicate: (packet: Packet) => boolean = () => true
): Promise<Packet> {
  return new Promise((resolve, reject) => {
    const received: Packet[] = [];
    const timeout = setTimeout(() => {
      socket.off('packet', onPacket);
      reject(
        new Error(
          `Timed out waiting for packet ${type}; received ${
            received.map(packet => `${packet.type}:${JSON.stringify(packet.data)}`).join(', ') ||
            'none'
          }`
        )
      );
    }, timeoutMs);

    const onPacket = (packet: Packet) => {
      received.push(packet);
      if (packet.type !== type || !predicate(packet)) return;
      clearTimeout(timeout);
      socket.off('packet', onPacket);
      resolve(packet);
    };

    socket.on('packet', onPacket);
  });
}

function waitForConnection(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket did not connect')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const onEvent = (data: T) => {
      clearTimeout(timeout);
      socket.off(event, onEvent);
      resolve(data);
    };

    socket.on(event, onEvent);
  });
}

function emitWithAck<T>(socket: ClientSocket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, data, (error: Error | null, response: T) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

describe('Socket game flow - Milestone 0 smoke test', () => {
  let httpServer: HttpServer;
  let io: SocketServer;
  let gameManager: GameManager;
  let serverUrl: string;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    await clearAllTables();
    (GameManager as any).instance = null;

    httpServer = createServer();
    io = new SocketServer(httpServer, { cors: { origin: '*' } });
    gameManager = GameManager.getInstance(io, getTestDatabaseProvider());
    const coordinator = new SocketCoordinator(gameManager, getTestDatabase());
    io.on('connection', socket => coordinator.setupSocket(io, socket));

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>(resolve => io.close(() => resolve()));
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    (GameManager as any).instance = null;
  });

  function connectClient(): ClientSocket {
    const client = createClient(serverUrl, { transports: ['websocket'], forceNew: true });
    clients.push(client);
    return client;
  }

  async function authenticate(client: ClientSocket, username: string): Promise<string> {
    const reply = waitForPacket(client, PacketType.SERVER_JOIN_REPLY);
    client.emit('packet', {
      type: PacketType.SERVER_JOIN_REQ,
      data: { username, version: 'civjs-test' },
    });
    const packet = await reply;
    expect(packet.data).toMatchObject({ accepted: true });
    return (packet.data as { playerId: string }).playerId;
  }

  /**
   * @evidence stack
   * @contract Two real Socket.IO clients can create, join, receive an authoritative map, advance a turn, and reconnect to the recovered session.
   */
  it('connects, creates and joins a game, loads its map, advances a turn, and reconnects', async () => {
    const host = connectClient();
    await waitForConnection(host);
    const hostUsername = `host-${generateTestUUID().slice(0, 20)}`;
    const hostUserId = await authenticate(host, hostUsername);

    const created = waitForPacket(host, PacketType.GAME_CREATE_REPLY);
    host.emit('packet', {
      type: PacketType.GAME_CREATE,
      data: {
        name: 'Socket smoke game',
        gameType: 'multiplayer',
        maxPlayers: 2,
        mapSizingMode: 'fixed',
        mapWidth: 40,
        mapHeight: 26,
        ruleset: 'civ2civ3',
        selectedNation: 'roman',
      },
    });
    const createReply = await created;
    expect(createReply.data).toMatchObject({ success: true });
    const gameId = (createReply.data as { gameId: string }).gameId;

    const guest = connectClient();
    await waitForConnection(guest);
    const guestUserId = await authenticate(guest, `guest-${generateTestUUID().slice(0, 19)}`);
    const mapPacket = waitForPacket(guest, PacketType.MAP_INFO);
    const joined = await emitWithAck<{ success: boolean; playerId: string }>(guest, 'join_game', {
      gameId,
      selectedNation: 'greek',
    });
    expect(joined).toMatchObject({ success: true });
    expect((await mapPacket).data).toMatchObject({ xsize: 40, ysize: 26 });

    const mapReply = await emitWithAck<{
      success: boolean;
      mapData: { width: number; height: number };
    }>(host, 'get_map_data', {});
    expect(mapReply.success).toBe(true);
    expect(mapReply.mapData).toMatchObject({ width: 40, height: 26 });

    // @reference reference/freeciv/server/unittools.c:1215-1280
    const hostPlayer = Array.from(gameManager.getGameInstance(gameId)!.players.values()).find(
      player => player.userId === hostUserId
    );
    expect(hostPlayer).toBeDefined();
    const unitStart = { x: 10, y: 10 };
    const gameInstance = gameManager.getGameInstance(gameId)!;
    const map = gameInstance.mapManager.getMapData()!;
    const topology = gameInstance.mapManager.getTopology();
    const moveTarget = topology.getNeighbors(unitStart.x, unitStart.y)[0];
    if (!moveTarget) throw new Error('Socket smoke test could not find a movement neighbor');
    const combatTarget = topology
      .getNeighbors(moveTarget.x, moveTarget.y)
      .find(position => position.x !== unitStart.x || position.y !== unitStart.y);
    if (!combatTarget) throw new Error('Socket smoke test could not find a combat neighbor');
    // Map generation is intentionally variable; pin only the two tiles this
    // transport-boundary movement assertion needs.
    // Clear generated extras as well: a goody hut on the movement target would
    // legitimately award random gold and contaminate the initial treasury
    // snapshot below.
    for (const tilePosition of [unitStart, moveTarget, combatTarget]) {
      const tile = map.tiles[tilePosition.x][tilePosition.y];
      tile.terrain = 'grassland';
      tile.resource = undefined;
      tile.improvements = [];
      tile.riverMask = 0;
      tile.hasRoad = false;
    }
    expect(getTerrainMovementCost(map.tiles[moveTarget.x][moveTarget.y].terrain, 'warriors')).toBe(
      SINGLE_MOVE
    );

    const unitId = await gameManager.createUnit(
      gameId,
      hostPlayer!.id,
      'warriors',
      unitStart.x,
      unitStart.y
    );
    const moveReply = waitForPacket(host, PacketType.UNIT_MOVE_REPLY);
    host.emit('packet', {
      type: PacketType.UNIT_MOVE,
      data: { unitId, x: moveTarget.x, y: moveTarget.y },
    });
    const moveResponse = await moveReply;
    if (!(moveResponse.data as { success: boolean }).success) {
      throw new Error(`UNIT_MOVE failed: ${JSON.stringify(moveResponse.data)}`);
    }
    expect(moveResponse.data).toMatchObject({
      success: true,
      unitId,
      newX: moveTarget!.x,
      newY: moveTarget!.y,
    });

    // @reference reference/freeciv/server/cityturn.c:338-390
    // Give the city a deterministic, unimproved grassland radius so this
    // twenty-turn flow also proves natural food accumulation and growth.
    for (const tilePosition of topology.getPositionsWithinRadius(8, 8, 2)) {
      const tile = map.tiles[tilePosition.x][tilePosition.y];
      tile.terrain = 'grassland';
      tile.resource = undefined;
      tile.improvements = ['road'];
      tile.riverMask = 1;
    }
    const settlerId = await gameManager.createUnit(gameId, hostPlayer!.id, 'settlers', 8, 8);
    const cityReply = waitForPacket(host, PacketType.CITY_FOUND_REPLY);
    host.emit('packet', {
      type: PacketType.CITY_FOUND,
      data: { unitId: settlerId, name: 'Socket City', x: 8, y: 8 },
    });
    const cityResponse = await cityReply;
    expect(cityResponse.data).toMatchObject({ success: true });
    const cityId = (cityResponse.data as { cityId: string }).cityId;

    const productionReply = waitForPacket(host, PacketType.CITY_PRODUCTION_CHANGE_REPLY);
    host.emit('packet', {
      type: PacketType.CITY_PRODUCTION_CHANGE,
      data: { cityId, production: 'barracks', type: 'building' },
    });
    expect((await productionReply).data).toMatchObject({ success: true });
    expect(gameManager.getGameInstance(gameId)?.cityManager.getCity(cityId)).toMatchObject({
      id: cityId,
      currentProduction: 'barracks',
    });

    const taxRateReply = await emitWithAck<{
      success: boolean;
      rates: { tax: number; luxury: number; science: number };
    }>(host, 'economy:setTaxRates', { tax: 30, luxury: 30, science: 40 });
    expect(taxRateReply).toEqual({
      success: true,
      rates: { tax: 30, luxury: 30, science: 40 },
    });

    const researchTarget = gameManager
      .getAvailableTechnologies(gameId, hostPlayer!.id)
      .sort((left, right) => left.cost - right.cost || left.id.localeCompare(right.id))[0]!;
    const researchReply = waitForPacket(host, PacketType.RESEARCH_SET_REPLY);
    host.emit('packet', {
      type: PacketType.RESEARCH_SET,
      data: { techId: researchTarget.id },
    });
    expect((await researchReply).data).toMatchObject({ success: true });
    expect(gameManager.getPlayerResearch(gameId, hostPlayer!.id)?.currentTech).toBe(
      researchTarget.id
    );

    type TurnSnapshot = {
      turn: number;
      population: number;
      foodStock: number;
      shieldStock: number;
      history: number;
      food: number;
      shields: number;
      trade: number;
      science: number;
      goldOutput: number;
      luxury: number;
      treasury: number;
      currentTech?: string;
      techCost: number;
      bulbs: number;
      bulbsLastTurn: number;
      researchedTechs: number;
    };

    type GoldenTurn = Pick<
      TurnSnapshot,
      | 'turn'
      | 'population'
      | 'foodStock'
      | 'shieldStock'
      | 'food'
      | 'shields'
      | 'trade'
      | 'science'
      | 'goldOutput'
      | 'luxury'
    > & {
      cumulativeGold: number;
      cumulativeScience: number;
    };

    // Independent golden ledger for the pinned C2C3 fixture above. The table
    // covers tile output, city workforce, corruption, tax allocation, and
    // growth over consecutive authoritative turns.
    //
    // Keep this table explicit: it is an external expectation for the full turn
    // pipeline, not a restatement of the production implementation.
    const goldenTurns: GoldenTurn[] = [
      {
        turn: 2,
        population: 1,
        foodStock: 3,
        shieldStock: 1,
        food: 3,
        shields: 1,
        trade: 4,
        science: 2,
        goldOutput: 1,
        luxury: 1,
        cumulativeGold: 1,
        cumulativeScience: 2,
      },
      {
        turn: 3,
        population: 1,
        foodStock: 6,
        shieldStock: 2,
        food: 3,
        shields: 1,
        trade: 4,
        science: 2,
        goldOutput: 1,
        luxury: 1,
        cumulativeGold: 2,
        cumulativeScience: 4,
      },
      {
        turn: 4,
        population: 1,
        foodStock: 9,
        shieldStock: 3,
        food: 3,
        shields: 1,
        trade: 4,
        science: 2,
        goldOutput: 1,
        luxury: 1,
        cumulativeGold: 3,
        cumulativeScience: 6,
      },
      {
        turn: 5,
        population: 1,
        foodStock: 12,
        shieldStock: 4,
        food: 3,
        shields: 1,
        trade: 4,
        science: 2,
        goldOutput: 1,
        luxury: 1,
        cumulativeGold: 4,
        cumulativeScience: 8,
      },
      {
        turn: 6,
        population: 1,
        foodStock: 15,
        shieldStock: 5,
        food: 3,
        shields: 1,
        trade: 4,
        science: 2,
        goldOutput: 1,
        luxury: 1,
        cumulativeGold: 5,
        cumulativeScience: 10,
      },
      {
        turn: 7,
        population: 1,
        foodStock: 18,
        shieldStock: 6,
        food: 3,
        shields: 1,
        trade: 4,
        science: 2,
        goldOutput: 1,
        luxury: 1,
        cumulativeGold: 6,
        cumulativeScience: 12,
      },
      {
        turn: 8,
        population: 2,
        foodStock: 11,
        shieldStock: 7,
        food: 3,
        shields: 1,
        trade: 5,
        science: 2,
        goldOutput: 3,
        luxury: 1,
        cumulativeGold: 9,
        cumulativeScience: 14,
      },
      {
        turn: 9,
        population: 2,
        foodStock: 14,
        shieldStock: 8,
        food: 3,
        shields: 1,
        trade: 5,
        science: 2,
        goldOutput: 3,
        luxury: 1,
        cumulativeGold: 12,
        cumulativeScience: 16,
      },
      {
        turn: 10,
        population: 2,
        foodStock: 17,
        shieldStock: 9,
        food: 3,
        shields: 1,
        trade: 5,
        science: 2,
        goldOutput: 3,
        luxury: 1,
        cumulativeGold: 15,
        cumulativeScience: 18,
      },
      {
        turn: 11,
        population: 3,
        foodStock: 10,
        shieldStock: 10,
        food: 3,
        shields: 1,
        trade: 7,
        science: 3,
        goldOutput: 3,
        luxury: 2,
        cumulativeGold: 18,
        cumulativeScience: 21,
      },
      {
        turn: 12,
        population: 3,
        foodStock: 13,
        shieldStock: 11,
        food: 3,
        shields: 1,
        trade: 7,
        science: 3,
        goldOutput: 3,
        luxury: 2,
        cumulativeGold: 21,
        cumulativeScience: 24,
      },
      {
        turn: 13,
        population: 3,
        foodStock: 16,
        shieldStock: 12,
        food: 3,
        shields: 1,
        trade: 7,
        science: 3,
        goldOutput: 3,
        luxury: 2,
        cumulativeGold: 24,
        cumulativeScience: 27,
      },
      {
        turn: 14,
        population: 3,
        foodStock: 19,
        shieldStock: 13,
        food: 3,
        shields: 1,
        trade: 7,
        science: 3,
        goldOutput: 3,
        luxury: 2,
        cumulativeGold: 27,
        cumulativeScience: 30,
      },
      {
        turn: 15,
        population: 4,
        foodStock: 12,
        shieldStock: 14,
        food: 3,
        shields: 1,
        trade: 9,
        science: 3,
        goldOutput: 5,
        luxury: 3,
        cumulativeGold: 32,
        cumulativeScience: 33,
      },
      {
        turn: 16,
        population: 4,
        foodStock: 15,
        shieldStock: 15,
        food: 3,
        shields: 1,
        trade: 9,
        science: 3,
        goldOutput: 5,
        luxury: 3,
        cumulativeGold: 37,
        cumulativeScience: 36,
      },
      {
        turn: 17,
        population: 4,
        foodStock: 18,
        shieldStock: 16,
        food: 3,
        shields: 1,
        trade: 9,
        science: 3,
        goldOutput: 5,
        luxury: 3,
        cumulativeGold: 42,
        cumulativeScience: 39,
      },
      {
        turn: 18,
        population: 5,
        foodStock: 1,
        shieldStock: 17,
        food: 3,
        shields: 1,
        trade: 11,
        science: 5,
        goldOutput: 5,
        luxury: 3,
        cumulativeGold: 47,
        cumulativeScience: 44,
      },
      {
        turn: 19,
        population: 5,
        foodStock: 4,
        shieldStock: 18,
        food: 3,
        shields: 1,
        trade: 11,
        science: 5,
        goldOutput: 5,
        luxury: 3,
        cumulativeGold: 52,
        cumulativeScience: 49,
      },
      {
        turn: 20,
        population: 5,
        foodStock: 7,
        shieldStock: 19,
        food: 3,
        shields: 1,
        trade: 11,
        science: 5,
        goldOutput: 5,
        luxury: 3,
        cumulativeGold: 57,
        cumulativeScience: 54,
      },
      {
        turn: 21,
        population: 5,
        foodStock: 10,
        shieldStock: 20,
        food: 3,
        shields: 1,
        trade: 11,
        science: 5,
        goldOutput: 5,
        luxury: 3,
        cumulativeGold: 62,
        cumulativeScience: 59,
      },
    ];

    const takeTurnSnapshot = async (): Promise<TurnSnapshot> => {
      const game = gameManager.getGameInstance(gameId)!;
      const city = game.cityManager.getCity(cityId)!;
      const research = game.researchManager.getPlayerResearch(hostPlayer!.id)!;
      const researchProgress = game.researchManager.getResearchProgress(hostPlayer!.id);
      return {
        turn: game.currentTurn,
        population: city.population,
        foodStock: city.foodStock ?? 0,
        shieldStock: city.shieldStock ?? 0,
        history: city.history,
        food: city.foodPerTurn ?? 0,
        shields: city.productionPerTurn ?? 0,
        trade: city.tradePerTurn ?? 0,
        science: city.sciencePerTurn ?? 0,
        goldOutput: city.goldPerTurn ?? 0,
        luxury: city.luxuryPerTurn ?? 0,
        treasury: await game.turnManager.getEconomicManager()!.getPlayerGold(hostPlayer!.id),
        currentTech: research.currentTech,
        techCost: researchProgress?.required ?? 0,
        bulbs: research.bulbsAccumulated,
        bulbsLastTurn: research.bulbsLastTurn,
        researchedTechs: research.researchedTechs.size,
      };
    };

    const assertTurnAccumulation = (before: TurnSnapshot, after: TurnSnapshot): void => {
      expect(after.turn).toBe(before.turn + 1);
      expect(after.food).toBeGreaterThan(0);
      expect(after.shields).toBeGreaterThan(0);
      expect(after.trade).toBeGreaterThan(0);
      // C2C3's output pipeline can add trade-derived output after the raw
      // trade total is calculated; the turn-by-turn C2C3 golden ledger below
      // asserts the exact values for this scenario.
      expect(after.science + after.goldOutput + after.luxury).toBeGreaterThanOrEqual(after.trade);

      if (after.population === before.population) {
        expect(after.foodStock).toBe(before.foodStock + after.food);
      } else {
        expect(after.population).toBe(before.population + 1);
        expect(after.foodStock).toBeGreaterThanOrEqual(0);
      }
      expect(after.shieldStock).toBe(before.shieldStock + after.shields);
      expect(after.history).toBeGreaterThan(before.history);
      expect(after.treasury).toBe(before.treasury + after.goldOutput);
      expect(after.bulbsLastTurn).toBe(after.science);

      if (after.currentTech === before.currentTech) {
        expect(after.bulbs).toBe(before.bulbs + after.science);
        expect(after.researchedTechs).toBe(before.researchedTechs);
      } else {
        expect(after.currentTech).toBeDefined();
        expect(after.bulbs).toBe(before.bulbs + after.science - before.techCost);
        expect(after.researchedTechs).toBeGreaterThan(before.researchedTechs);
      }
    };

    const ensureResearchTarget = async (): Promise<void> => {
      if (gameManager.getPlayerResearch(gameId, hostPlayer!.id)?.currentTech) return;
      const nextTarget = gameManager
        .getAvailableTechnologies(gameId, hostPlayer!.id)
        .sort((left, right) => right.cost - left.cost || left.id.localeCompare(right.id))[0]!;
      const reply = waitForPacket(host, PacketType.RESEARCH_SET_REPLY);
      host.emit('packet', {
        type: PacketType.RESEARCH_SET,
        data: { techId: nextTarget.id },
      });
      expect((await reply).data).toMatchObject({ success: true });
    };

    const advanceTurn = async (): Promise<Packet> => {
      const hostTurnReply = waitForPacket(host, PacketType.TURN_END_REPLY);
      host.emit('packet', { type: PacketType.END_TURN, data: {} });
      expect((await hostTurnReply).data).toMatchObject({ success: true, turnAdvanced: false });
      const playerInfoReply = waitForPacket(
        host,
        PacketType.PLAYER_INFO,
        packet => (packet.data as { id?: string }).id === hostPlayer!.id
      );
      const guestTurnReply = waitForPacket(guest, PacketType.TURN_END_REPLY);
      guest.emit('packet', { type: PacketType.END_TURN, data: {} });
      expect((await guestTurnReply).data).toMatchObject({ success: true, turnAdvanced: true });
      return playerInfoReply;
    };

    const initialSnapshot = await takeTurnSnapshot();
    expect(initialSnapshot).toMatchObject({
      turn: 1,
      population: 1,
      foodStock: 0,
      shieldStock: 0,
      treasury: 50,
      bulbs: 0,
      bulbsLastTurn: 0,
      researchedTechs: 1,
    });

    const turnSnapshots: TurnSnapshot[] = [];
    for (let completedTurns = 0; completedTurns < 20; completedTurns += 1) {
      await ensureResearchTarget();
      const before = await takeTurnSnapshot();
      const playerInfo = await advanceTurn();
      const after = await takeTurnSnapshot();
      assertTurnAccumulation(before, after);
      const { cumulativeGold, cumulativeScience, ...expectedSnapshot } =
        goldenTurns[completedTurns];
      expect(after).toMatchObject(expectedSnapshot);
      expect(after.treasury).toBe(initialSnapshot.treasury + cumulativeGold);
      expect(playerInfo.data).toMatchObject({
        id: hostPlayer!.id,
        gold: after.treasury,
        goldPerTurn: after.goldOutput,
        science: after.bulbs,
        sciencePerTurn: after.science,
      });
      expect(
        turnSnapshots.reduce((total, snapshot) => total + snapshot.science, 0) + after.science
      ).toBe(cumulativeScience);
      turnSnapshots.push(after);
    }

    const guestPlayer = Array.from(gameManager.getGameInstance(gameId)!.players.values()).find(
      player => player.userId === guestUserId
    );
    const defenderId = await gameManager.createUnit(
      gameId,
      guestPlayer!.id,
      'warriors',
      combatTarget.x,
      combatTarget.y
    );
    await (gameManager as any).diplomacyManager.establishContact(
      gameId,
      hostPlayer!.id,
      guestPlayer!.id
    );
    await gameManager.declareWar(gameId, hostPlayer!.id, guestPlayer!.id);
    const attackReply = waitForPacket(host, PacketType.UNIT_ATTACK_REPLY);
    host.emit('packet', {
      type: PacketType.UNIT_ATTACK,
      data: { attackerUnitId: unitId, defenderUnitId: defenderId },
    });
    expect((await attackReply).data).toMatchObject({ success: true });

    expect(gameManager.getGameInstance(gameId)?.currentTurn).toBe(21);
    const cityAfterTwentyTurns = gameManager.getGameInstance(gameId)?.cityManager.getCity(cityId);
    expect(cityAfterTwentyTurns).toMatchObject({
      id: cityId,
      population: 5,
      foodStock: 10,
    });
    expect(cityAfterTwentyTurns!.productionPerTurn).toBeGreaterThan(0);
    expect(cityAfterTwentyTurns!.tradePerTurn).toBeGreaterThan(0);
    expect(cityAfterTwentyTurns!.sciencePerTurn).toBeGreaterThan(0);
    expect(cityAfterTwentyTurns!.goldPerTurn).toBeGreaterThanOrEqual(0);
    expect(turnSnapshots.some(snapshot => snapshot.luxury > 0)).toBe(true);
    expect(cityAfterTwentyTurns!.history).toBeGreaterThan(0);
    const hostResearchBeforeRecovery = gameManager.getPlayerResearch(gameId, hostPlayer!.id);
    const guestResearchBeforeRecovery = gameManager.getPlayerResearch(gameId, guestPlayer!.id);
    expect(hostResearchBeforeRecovery).toBeDefined();
    expect(
      hostResearchBeforeRecovery!.researchedTechs.size > 0 ||
        hostResearchBeforeRecovery!.bulbsAccumulated > 0
    ).toBe(true);
    gameManager.updatePlayerVisibility(gameId, hostPlayer!.id);
    expect(
      gameManager.getTileVisibility(gameId, hostPlayer!.id, moveTarget!.x, moveTarget!.y)
    ).toMatchObject({ isExplored: true });
    expect(gameManager.getGameInstance(gameId)?.borderManager.getAllTileOwnership()).toEqual(
      expect.arrayContaining([expect.objectContaining({ x: 8, y: 8, playerId: hostPlayer!.id })])
    );
    const activeGameBeforeRecovery = gameManager.getGameInstance(gameId)!;
    const attackerBeforeRecovery = activeGameBeforeRecovery.unitManager.getUnit(unitId);
    const defenderBeforeRecovery = activeGameBeforeRecovery.unitManager.getUnit(defenderId);

    // Simulate a server restart: only PostgreSQL state remains before the
    // returning socket asks to rejoin the active game.
    gameManager.clearAllGames();
    const recoveredGame = await gameManager.recoverGameInstance(gameId);
    expect(recoveredGame).toMatchObject({ id: gameId, currentTurn: 21 });
    expect(recoveredGame?.cityManager.getCity(cityId)).toMatchObject({ id: cityId });
    const recoveredHostResearch = recoveredGame?.researchManager.getPlayerResearch(hostPlayer!.id);
    expect(recoveredHostResearch).toMatchObject({
      currentTech: hostResearchBeforeRecovery?.currentTech,
      bulbsAccumulated: hostResearchBeforeRecovery?.bulbsAccumulated,
      bulbsLastTurn: hostResearchBeforeRecovery?.bulbsLastTurn,
    });
    expect(recoveredHostResearch?.researchedTechs).toEqual(
      hostResearchBeforeRecovery?.researchedTechs
    );
    expect(
      await recoveredGame?.turnManager.getEconomicManager()?.getPlayerGold(hostPlayer!.id)
    ).toBe(turnSnapshots.at(-1)?.treasury);
    expect(
      recoveredGame?.researchManager.getPlayerResearch(guestPlayer!.id)?.researchedTechs
    ).toEqual(guestResearchBeforeRecovery?.researchedTechs);
    expect(recoveredGame?.borderManager.getAllTileOwnership()).toEqual(
      expect.arrayContaining([expect.objectContaining({ x: 8, y: 8, playerId: hostPlayer!.id })])
    );
    if (attackerBeforeRecovery) {
      expect(recoveredGame?.unitManager.getUnit(unitId)).toMatchObject(attackerBeforeRecovery);
    } else {
      expect(recoveredGame?.unitManager.getUnit(unitId)).toBeUndefined();
    }
    if (defenderBeforeRecovery) {
      expect(recoveredGame?.unitManager.getUnit(defenderId)).toMatchObject(defenderBeforeRecovery);
    } else {
      expect(recoveredGame?.unitManager.getUnit(defenderId)).toBeUndefined();
    }

    host.disconnect();
    const returning = connectClient();
    await waitForConnection(returning);
    await authenticate(returning, hostUsername);
    const returningMap = waitForPacket(returning, PacketType.MAP_INFO);
    const returningCities = waitForEvent<{
      gameId: string;
      cities: Record<string, { id: string; name: string }>;
    }>(returning, 'cities_updated');
    const reconnect = await emitWithAck<{ success: boolean; playerId: string }>(
      returning,
      'join_game',
      { gameId, selectedNation: 'roman' }
    );
    expect(reconnect).toMatchObject({ success: true });
    expect((await returningMap).data).toMatchObject({ xsize: 40, ysize: 26 });
    expect(await returningCities).toMatchObject({
      gameId,
      cities: { [cityId]: expect.objectContaining({ id: cityId, name: 'Socket City' }) },
    });

    // A recovered game must continue processing through the real broadcaster;
    // otherwise the next completed turn replaces the reconnect payload with
    // the old empty-city mock update.
    const returningTurnReply = waitForPacket(returning, PacketType.TURN_END_REPLY);
    returning.emit('packet', { type: PacketType.END_TURN, data: {} });
    expect((await returningTurnReply).data).toMatchObject({ success: true, turnAdvanced: false });

    const citiesAfterRecoveredTurn = waitForEvent<{
      gameId: string;
      cities: Record<string, { id: string; name: string }>;
    }>(returning, 'cities_updated');
    const guestTurnAfterRecovery = waitForPacket(guest, PacketType.TURN_END_REPLY);
    guest.emit('packet', { type: PacketType.END_TURN, data: {} });
    expect((await guestTurnAfterRecovery).data).toMatchObject({
      success: true,
      turnAdvanced: true,
    });
    expect(await citiesAfterRecoveredTurn).toMatchObject({
      gameId,
      cities: { [cityId]: expect.objectContaining({ id: cityId, name: 'Socket City' }) },
    });
    expect(gameManager.getGameInstance(gameId)?.currentTurn).toBe(22);
  });
});
