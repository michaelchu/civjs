/**
 * @module server/network/SocketRooms
 * Defines shared Socket.IO room names used across handlers and broadcasters.
 */

export const getGameRoom = (gameId: string): string => `game:${gameId}`;

/** Omniscient, read-only presentation stream for active observers. */
export const getSpectatorRoom = (gameId: string): string => `${getGameRoom(gameId)}:spectators`;
