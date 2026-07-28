import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { PacketType, type Packet } from '../../types/packets';

type PacketListener = (packet: Packet<Record<string, unknown>>) => void;

describe('GameClient research packets', () => {
  const listeners = new Set<PacketListener>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: PacketListener) => {
      if (event === 'packet') listeners.add(listener);
    }),
    off: vi.fn((_event: string, listener: PacketListener) => listeners.delete(listener)),
    emit: vi.fn(),
  };

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
    useGameStore.getState().updateGameState({ technologies: {} });
    useGameStore.getState().updateResearchState({
      currentTech: undefined,
      techGoal: undefined,
      bulbsAccumulated: 0,
      researchedTechs: new Set(),
      availableTechs: new Set(),
    });
  });

  it('sets research only after the authoritative reply succeeds', async () => {
    socket.emit.mockImplementation((event: string, request: Packet) => {
      if (event !== 'packet' || request.type !== PacketType.RESEARCH_SET) return;
      expect(request.data).toEqual({ techId: 'writing' });
      queueMicrotask(() => {
        listeners.forEach(listener =>
          listener({
            type: PacketType.RESEARCH_SET_REPLY,
            requestId: request.requestId,
            data: { success: true },
          })
        );
      });
    });

    await gameClient.setResearch('writing');

    expect(useGameStore.getState().research?.currentTech).toBe('writing');
  });

  it('surfaces a rejected research choice without changing local state', async () => {
    socket.emit.mockImplementation((event: string, request: Packet) => {
      if (event !== 'packet' || request.type !== PacketType.RESEARCH_SET) return;
      queueMicrotask(() => {
        listeners.forEach(listener =>
          listener({
            type: PacketType.RESEARCH_SET_REPLY,
            requestId: request.requestId,
            data: { success: false, message: 'Technology is not available' },
          })
        );
      });
    });

    await expect(gameClient.setResearch('future-tech')).rejects.toThrow(
      'Technology is not available'
    );
    expect(useGameStore.getState().research?.currentTech).toBeUndefined();
  });

  it('correlates concurrent requests of the same packet type', async () => {
    const requests: Packet[] = [];
    socket.emit.mockImplementation((event: string, request: Packet) => {
      if (event === 'packet' && request.type === PacketType.RESEARCH_SET) {
        requests.push(request);
      }
    });
    const resolutions: string[] = [];

    const writing = gameClient.setResearch('writing').then(() => resolutions.push('writing'));
    const pottery = gameClient.setResearch('pottery').then(() => resolutions.push('pottery'));
    const potteryRequest = requests.find(request => request.data.techId === 'pottery');
    const writingRequest = requests.find(request => request.data.techId === 'writing');

    listeners.forEach(listener =>
      listener({
        type: PacketType.RESEARCH_SET_REPLY,
        requestId: potteryRequest?.requestId,
        data: { success: true },
      })
    );
    await pottery;
    expect(resolutions).toEqual(['pottery']);

    listeners.forEach(listener =>
      listener({
        type: PacketType.RESEARCH_SET_REPLY,
        requestId: writingRequest?.requestId,
        data: { success: true },
      })
    );
    await writing;
    expect(resolutions).toEqual(['pottery', 'writing']);
  });

  it('hydrates the research tree and progress from server packets', () => {
    const handlePacket = (
      gameClient as unknown as { handlePacket: (packet: Packet<Record<string, unknown>>) => void }
    ).handlePacket.bind(gameClient);

    handlePacket({
      type: PacketType.RESEARCH_LIST_REPLY,
      data: {
        technologies: [
          {
            id: 'alphabet',
            name: 'Alphabet',
            cost: 10,
            requirements: [],
            flags: [],
          },
          {
            id: 'writing',
            name: 'Writing',
            cost: 20,
            requirements: ['alphabet'],
            flags: [],
          },
        ],
        researchedTechs: ['alphabet'],
        availableTechs: [
          {
            id: 'writing',
            name: 'Writing',
            cost: 40,
            requirements: ['alphabet'],
            flags: [],
          },
        ],
        futureTechs: 0,
      },
    });
    handlePacket({
      type: PacketType.RESEARCH_PROGRESS_REPLY,
      data: {
        currentTech: 'writing',
        techGoal: 'literacy',
        current: 17,
        bulbsLastTurn: 3,
      },
    });

    const state = useGameStore.getState();
    expect(state.technologies.writing).toEqual(
      expect.objectContaining({ name: 'Writing', discovered: false })
    );
    expect(state.research?.researchedTechs).toEqual(new Set(['alphabet']));
    expect(state.research?.availableTechs).toEqual(new Set(['writing']));
    expect(state.research?.futureTechs).toBe(0);
    expect(state.research).toEqual(
      expect.objectContaining({
        currentTech: 'writing',
        techGoal: 'literacy',
        bulbsAccumulated: 17,
        bulbsLastTurn: 3,
      })
    );
  });

  it('requests both the research list and current progress', () => {
    gameClient.refreshResearch();

    expect(socket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({ type: PacketType.RESEARCH_LIST, data: {} })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({ type: PacketType.RESEARCH_PROGRESS, data: {} })
    );
  });
});
