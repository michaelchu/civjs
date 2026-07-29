import {
  ACTIVE_PACKET_CONTRACT,
  PACKET_NAMES,
  PROTOCOL_VERSION,
  PacketType,
  SOCKET_EVENT_CONTRACT,
} from '@app-types/shared/packetContract';

describe('canonical packet contract', () => {
  it('pins deployed protocol v1 identifiers without duplicate numeric values', () => {
    const identifiers = Object.values(PacketType).filter(
      (value): value is number => typeof value === 'number'
    );

    expect(PROTOCOL_VERSION).toBe(1);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(PacketType.GAME_INFO).toBe(19);
    expect(PacketType.PLAYER_INFO).toBe(14);
    expect(PacketType.NEW_YEAR).toBe(127);
    expect(identifiers.every(identifier => Boolean(PACKET_NAMES[identifier]))).toBe(true);
  });

  it('defines each active packet once with its direction and endpoint evidence', () => {
    const activeTypes = ACTIVE_PACKET_CONTRACT.map(entry => entry.type);

    expect(new Set(activeTypes).size).toBe(activeTypes.length);
    for (const entry of ACTIVE_PACKET_CONTRACT) {
      expect(entry.name).toBe(PACKET_NAMES[entry.type]);
      expect(entry.lifecycle).toBe('active');
      if (entry.direction !== 'server_to_client') {
        expect(entry.serverHandler).toBeTruthy();
      }
      if (entry.direction !== 'client_to_server') {
        expect(entry.clientConsumer).toBeTruthy();
      }
    }
  });

  it('classifies named events as native, lifecycle, notification, or packet compatibility', () => {
    expect(new Set(SOCKET_EVENT_CONTRACT.map(entry => entry.event)).size).toBe(
      SOCKET_EVENT_CONTRACT.length
    );
    for (const event of SOCKET_EVENT_CONTRACT) {
      expect(event.sinceVersion).toBeLessThanOrEqual(PROTOCOL_VERSION);
      if (event.classification === 'compatibility') {
        if (event.canonicalPacket !== undefined) {
          expect(ACTIVE_PACKET_CONTRACT.some(entry => entry.type === event.canonicalPacket)).toBe(
            true
          );
        }
      }
    }
  });
});
