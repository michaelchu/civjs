import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import PhaserGame, { type PhaserGameHandle } from './PhaserGame';

export default function GameBoard() {
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
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <h1 className="text-xl font-bold">{currentGame.name}</h1>
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-gray-300">
                Turn {currentGame.currentTurn}
              </span>
              <span className="text-gray-300">•</span>
              <span className="text-yellow-400">Current Player: Player 1</span>
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
          {/* Phaser Game Canvas */}
          <div className="absolute inset-0">
            <PhaserGame
              ref={phaserRef}
              gameId={gameId!}
              gameState={gameState}
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
    </div>
  );
}
