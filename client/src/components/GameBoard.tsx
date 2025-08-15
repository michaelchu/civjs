import { useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { Game } from '../../../shared/types';

interface GameBoardProps {
  game: Game;
  onExitGame: () => void;
}

export default function GameBoard({ game, onExitGame }: GameBoardProps) {
  const { gameState, loadGameState, loading } = useGameStore();

  useEffect(() => {
    // Load the game state when component mounts
    loadGameState(game.id);
  }, [game.id, loadGameState]);

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
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <h1 className="text-xl font-bold">{game.name}</h1>
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-gray-300">Turn {game.currentTurn}</span>
              <span className="text-gray-300">•</span>
              <span className="text-yellow-400">Current Player: Player 1</span>
            </div>
          </div>
          <button
            onClick={onExitGame}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Exit Game
          </button>
        </div>
      </div>

      <div className="flex h-screen">
        {/* Left Sidebar - Game Info */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 p-4">
          <div className="space-y-4">
            {/* Player Resources */}
            <div className="bg-gray-700 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-3">Resources</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="text-yellow-400 text-xl font-bold">150</div>
                  <div className="text-xs text-gray-400">Gold</div>
                </div>
                <div className="text-center">
                  <div className="text-blue-400 text-xl font-bold">25</div>
                  <div className="text-xs text-gray-400">Science</div>
                </div>
                <div className="text-center">
                  <div className="text-green-400 text-xl font-bold">40</div>
                  <div className="text-xs text-gray-400">Food</div>
                </div>
                <div className="text-center">
                  <div className="text-orange-400 text-xl font-bold">30</div>
                  <div className="text-xs text-gray-400">Production</div>
                </div>
              </div>
            </div>

            {/* Game State Debug Info */}
            <div className="bg-gray-700 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-3">Game State</h2>
              {gameState ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Map Tiles:</span>
                    <span>{gameState.map?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Units:</span>
                    <span>{gameState.units?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Cities:</span>
                    <span>{gameState.cities?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Players:</span>
                    <span>{gameState.players?.length || 0}</span>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-sm">
                  No game state loaded
                </div>
              )}
            </div>

            {/* Units List */}
            <div className="bg-gray-700 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-3">Your Units</h2>
              {gameState?.units?.length ? (
                <div className="space-y-2">
                  {gameState.units.slice(0, 5).map((unit: any) => (
                    <div
                      key={unit.id}
                      className="flex items-center justify-between p-2 bg-gray-600 rounded"
                    >
                      <div>
                        <div className="text-sm font-medium">{unit.type}</div>
                        <div className="text-xs text-gray-400">
                          ({unit.x}, {unit.y})
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">
                        {unit.health}/100 HP
                      </div>
                    </div>
                  ))}
                  {gameState.units.length > 5 && (
                    <div className="text-xs text-gray-400 text-center">
                      +{gameState.units.length - 5} more units
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-gray-400 text-sm">No units available</div>
              )}
            </div>
          </div>
        </div>

        {/* Main Game Area */}
        <div className="flex-1 relative">
          {/* Map Placeholder */}
          <div className="absolute inset-0 bg-gradient-to-br from-green-800 to-blue-900 flex items-center justify-center">
            <div className="text-center">
              <div className="w-32 h-32 border-4 border-dashed border-white rounded-lg flex items-center justify-center mb-4 mx-auto">
                <svg
                  className="w-16 h-16 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm8 2a1 1 0 100 2h2a1 1 0 100-2h-2z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2">Game Map</h2>
              <p className="text-gray-300 mb-4">
                Map rendering will be implemented here
              </p>
              <p className="text-sm text-gray-400">
                This is where the hexagonal game map,
                <br />
                units, cities, and terrain will be displayed
              </p>
            </div>
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
    </div>
  );
}
