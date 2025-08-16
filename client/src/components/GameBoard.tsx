import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import PhaserGame, { type PhaserGameHandle } from './PhaserGame';

interface GameBoardProps {
  connected: boolean;
}

export default function GameBoard({ connected }: GameBoardProps) {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { currentGame, gameState, loadGameState, loading } = useGameStore();
  const phaserRef = useRef<PhaserGameHandle>(null);

  useEffect(() => {
    // Load the game state when component mounts
    if (gameId) {
      loadGameState(gameId);
    }
  }, [gameId, loadGameState]);

  // Redirect if no current game or game ID doesn't match
  useEffect(() => {
    if (!currentGame || currentGame.id !== gameId) {
      navigate('/games');
    }
  }, [currentGame, gameId, navigate]);

  if (!currentGame || currentGame.id !== gameId) {
    return null; // Will redirect
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg p-8 shadow-lg">
          <div className="flex items-center justify-center mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
          <p className="text-gray-600">Loading game state...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <h1 className="text-xl font-bold">{currentGame.name}</h1>
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-gray-300">
                Turn {currentGame.currentTurn}
              </span>
              <span className="text-gray-300">•</span>
              <span className="text-yellow-400">Current Player: Player 1</span>
              <span className="text-gray-300">•</span>
              <div className="flex items-center space-x-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    connected ? 'bg-green-400' : 'bg-red-400'
                  }`}
                />
                <span className={connected ? 'text-green-400' : 'text-red-400'}>
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/games')}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Exit Game
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 relative">
        {/* Phaser Game Canvas */}
        <div className="absolute inset-0">
          <PhaserGame
            ref={phaserRef}
            gameId={gameId!}
            gameState={
              gameState
                ? {
                    mapWidth:
                      gameState.map?.length > 0
                        ? Math.max(...gameState.map.map((t: any) => t.x)) + 1
                        : 40,
                    mapHeight:
                      gameState.map?.length > 0
                        ? Math.max(...gameState.map.map((t: any) => t.y)) + 1
                        : 40,
                    map: gameState.map || [],
                    units: gameState.units || [],
                    cities: gameState.cities || [],
                  }
                : null
            }
            onTileClick={(x, y) => {
              console.log(`Tile clicked at (${x}, ${y})`);
            }}
            onUnitSelect={unitId => {
              console.log(`Unit selected: ${unitId}`);
            }}
            onEndTurn={() => {
              console.log('End turn requested');
            }}
          />
        </div>

        {/* Bottom Action Bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium">
                Next Unit
              </button>
              <button className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm font-medium">
                Found City
              </button>
              <button className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded text-sm font-medium">
                Tech Tree
              </button>
            </div>
            <button className="bg-yellow-600 hover:bg-yellow-700 px-6 py-2 rounded font-medium">
              End Turn
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
