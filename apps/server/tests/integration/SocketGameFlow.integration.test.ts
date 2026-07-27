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
import { playerTechs } from '@database/schema';
import {
  clearAllTables,
  generateTestUUID,
  getTestDatabase,
  getTestDatabaseProvider,
} from '../utils/testDatabase';
import { and, eq } from 'drizzle-orm';

const timeoutMs = 10_000;

function waitForPacket(socket: ClientSocket, type: PacketType): Promise<Packet> {
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
      if (packet.type !== type) return;
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
        mapWidth: 20,
        mapHeight: 20,
        selectedNation: 'romans',
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
      selectedNation: 'greeks',
    });
    expect(joined).toMatchObject({ success: true });
    expect((await mapPacket).data).toMatchObject({ xsize: 20, ysize: 20 });

    const mapReply = await emitWithAck<{
      success: boolean;
      mapData: { width: number; height: number };
    }>(host, 'get_map_data', {});
    expect(mapReply.success).toBe(true);
    expect(mapReply.mapData).toMatchObject({ width: 20, height: 20 });

    // @reference reference/freeciv/server/unittools.c:1215-1280
    const hostPlayer = Array.from(gameManager.getGameInstance(gameId)!.players.values()).find(
      player => player.userId === hostUserId
    );
    expect(hostPlayer).toBeDefined();
    const unitStart = { x: 10, y: 10 };
    const map = gameManager.getGameInstance(gameId)!.mapManager.getMapData()!;
    const moveTarget = { x: unitStart.x + 1, y: unitStart.y };
    // Map generation is intentionally variable; pin only the two tiles this
    // transport-boundary movement assertion needs.
    map.tiles[unitStart.x][unitStart.y].terrain = 'grassland';
    map.tiles[moveTarget.x][moveTarget.y].terrain = 'grassland';
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
    for (let x = 6; x <= 10; x += 1) {
      for (let y = 6; y <= 10; y += 1) {
        map.tiles[x][y].terrain = 'grassland';
        map.tiles[x][y].resource = undefined;
        map.tiles[x][y].improvements = ['road'];
        map.tiles[x][y].riverMask = 1;
      }
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
      expect(after.science + after.goldOutput + after.luxury).toBe(after.trade);

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

    const advanceTurn = async (): Promise<void> => {
      const hostTurnReply = waitForPacket(host, PacketType.TURN_END_REPLY);
      host.emit('packet', { type: PacketType.END_TURN, data: {} });
      expect((await hostTurnReply).data).toMatchObject({ success: true, turnAdvanced: false });
      const guestTurnReply = waitForPacket(guest, PacketType.TURN_END_REPLY);
      guest.emit('packet', { type: PacketType.END_TURN, data: {} });
      expect((await guestTurnReply).data).toMatchObject({ success: true, turnAdvanced: true });
    };

    const turnSnapshots: TurnSnapshot[] = [];
    for (let completedTurns = 0; completedTurns < 20; completedTurns += 1) {
      await ensureResearchTarget();
      const before = await takeTurnSnapshot();
      await advanceTurn();
      const after = await takeTurnSnapshot();
      assertTurnAccumulation(before, after);
      turnSnapshots.push(after);
    }

    const guestPlayer = Array.from(gameManager.getGameInstance(gameId)!.players.values()).find(
      player => player.userId === guestUserId
    );
    const defenderId = await gameManager.createUnit(
      gameId,
      guestPlayer!.id,
      'warriors',
      moveTarget!.x + 1,
      moveTarget!.y
    );
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
      population: 2,
      foodStock: 20,
    });
    expect(cityAfterTwentyTurns!.productionPerTurn).toBeGreaterThan(0);
    expect(cityAfterTwentyTurns!.tradePerTurn).toBeGreaterThan(0);
    expect(cityAfterTwentyTurns!.sciencePerTurn).toBeGreaterThan(0);
    expect(cityAfterTwentyTurns!.goldPerTurn).toBeGreaterThanOrEqual(0);
    expect(turnSnapshots.some(snapshot => snapshot.luxury > 0)).toBe(true);
    expect(cityAfterTwentyTurns!.history).toBeGreaterThan(0);
    const hostResearchBeforeRecovery = gameManager.getPlayerResearch(gameId, hostPlayer!.id);
    expect(hostResearchBeforeRecovery).toBeDefined();
    expect(
      hostResearchBeforeRecovery!.researchedTechs.size > 1 ||
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
      recoveredGame?.researchManager.getPlayerResearch(guestPlayer!.id)?.researchedTechs
    ).toEqual(new Set(['alphabet']));
    const guestStartingTechRows = await getTestDatabase()
      .select()
      .from(playerTechs)
      .where(and(eq(playerTechs.gameId, gameId), eq(playerTechs.playerId, guestPlayer!.id)));
    expect(guestStartingTechRows).toHaveLength(1);
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
      { gameId, selectedNation: 'romans' }
    );
    expect(reconnect).toMatchObject({ success: true });
    expect((await returningMap).data).toMatchObject({ xsize: 20, ysize: 20 });
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
