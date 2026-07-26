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
    const moveTarget = [
      { x: unitStart.x + 1, y: unitStart.y },
      { x: unitStart.x - 1, y: unitStart.y },
      { x: unitStart.x, y: unitStart.y + 1 },
      { x: unitStart.x, y: unitStart.y - 1 },
    ].find(({ x, y }) => {
      const terrain = map.tiles[x]?.[y]?.terrain;
      return terrain && getTerrainMovementCost(terrain, 'warriors') <= SINGLE_MOVE;
    });
    expect(moveTarget).toBeDefined();

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
      data: { unitId, x: moveTarget!.x, y: moveTarget!.y },
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
      data: { cityId, production: 'warriors', type: 'unit' },
    });
    expect((await productionReply).data).toMatchObject({ success: true });

    const researchReply = waitForPacket(host, PacketType.RESEARCH_SET_REPLY);
    host.emit('packet', { type: PacketType.RESEARCH_SET, data: { techId: 'pottery' } });
    expect((await researchReply).data).toMatchObject({ success: true });
    expect(gameManager.getPlayerResearch(gameId, hostPlayer!.id)?.currentTech).toBe('pottery');

    const hostTurnReply = waitForPacket(host, PacketType.TURN_END_REPLY);
    host.emit('packet', { type: PacketType.END_TURN, data: {} });
    expect((await hostTurnReply).data).toMatchObject({ success: true, turnAdvanced: false });
    const guestTurnReply = waitForPacket(guest, PacketType.TURN_END_REPLY);
    guest.emit('packet', { type: PacketType.END_TURN, data: {} });
    expect((await guestTurnReply).data).toMatchObject({ success: true, turnAdvanced: true });

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

    for (let completedTurns = 1; completedTurns < 20; completedTurns += 1) {
      const hostTurnReply = waitForPacket(host, PacketType.TURN_END_REPLY);
      host.emit('packet', { type: PacketType.END_TURN, data: {} });
      expect((await hostTurnReply).data).toMatchObject({ success: true, turnAdvanced: false });

      const guestTurnReply = waitForPacket(guest, PacketType.TURN_END_REPLY);
      guest.emit('packet', { type: PacketType.END_TURN, data: {} });
      expect((await guestTurnReply).data).toMatchObject({ success: true, turnAdvanced: true });
    }
    expect(gameManager.getGameInstance(gameId)?.currentTurn).toBe(21);

    host.disconnect();
    const returning = connectClient();
    await waitForConnection(returning);
    await authenticate(returning, hostUsername);
    const reconnect = await emitWithAck<{ success: boolean; playerId: string }>(
      returning,
      'join_game',
      { gameId, selectedNation: 'romans' }
    );
    expect(reconnect).toMatchObject({ success: true });
  });
});
