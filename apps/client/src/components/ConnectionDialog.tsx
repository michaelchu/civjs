import React, { useState } from 'react';
import { gameClient } from '../services/GameClient';
import { useGameStore } from '../store/gameStore';
import { SERVER_URL } from '../config';

interface ConnectionDialogProps {
  showForm?: boolean;
}

export const ConnectionDialog: React.FC<ConnectionDialogProps> = ({
  showForm = true,
}) => {
  const [playerName, setPlayerName] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const { clientState, setClientState } = useGameStore();

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!playerName.trim()) {
      setError('Please enter a player name');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      await gameClient.connect();
      gameClient.joinGame(playerName.trim());
      setClientState('preparing');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect to server'
      );
    } finally {
      setIsConnecting(false);
    }
  };

  if (!showForm) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-lg">
            {clientState === 'connecting' && 'Connecting to game...'}
            {clientState === 'waiting_for_players' &&
              'Waiting for other players...'}
            {clientState === 'joining_game' && 'Joining game...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-96 border border-gray-700">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">CivJS</h1>
          <p className="text-gray-300">
            {clientState === 'connecting' && 'Connecting to server...'}
            {clientState === 'waiting_for_players' &&
              'Waiting for other players...'}
            {clientState === 'joining_game' && 'Joining game...'}
          </p>
          {clientState === 'waiting_for_players' && (
            <p className="text-gray-400 text-sm mt-2">
              Game will start once all players are ready
            </p>
          )}
        </div>

        <form onSubmit={handleConnect} className="space-y-6">
          <div>
            <label
              htmlFor="playerName"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Player Name
            </label>
            <input
              id="playerName"
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isConnecting}
              maxLength={32}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-900 border border-red-700 rounded-md text-red-200 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting || !playerName.trim()}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 text-white font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          >
            {isConnecting ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin w-5 h-5 border-2 border-blue-300 border-t-transparent rounded-full mr-2"></div>
                Connecting...
              </div>
            ) : (
              'Connect to Game'
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-700">
          <div className="text-xs text-gray-400 text-center">
            <p>Server: {SERVER_URL}</p>
            <p className="mt-1">
              Make sure the server is running before connecting
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
