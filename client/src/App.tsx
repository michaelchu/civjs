import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from './stores/gameStore';
import GamesList from './components/GamesList';
import CreateGame from './components/CreateGame';
import GameLobby from './components/GameLobby';
import GameBoard from './components/GameBoard';
import type { Game } from '../../shared/types';

type AppView = 'menu' | 'games-list' | 'create-game' | 'game-lobby' | 'game-board';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>('menu');
  const { currentGame, setCurrentGame, error, clearError } = useGameStore();

  useEffect(() => {
    // Connect to the server
    const newSocket = io('http://localhost:3001');
    
    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const handleSelectGame = (game: Game) => {
    setCurrentGame(game);
    setCurrentView('game-lobby');
  };

  const handleGameCreated = (gameId: string) => {
    // Game is already set in the store by createGame
    setCurrentView('game-lobby');
  };

  const handleStartGame = () => {
    setCurrentView('game-board');
  };

  const handleBackToMenu = () => {
    setCurrentGame(null);
    setCurrentView('menu');
    clearError();
  };

  const handleBackToGamesList = () => {
    setCurrentGame(null);
    setCurrentView('games-list');
    clearError();
  };

  // Menu View
  if (currentView === 'menu') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <h1 className="text-4xl font-bold text-gray-800 mb-4 text-center">CivJS</h1>
          <p className="text-gray-600 mb-6 text-center">Browser-based Civilization Game</p>
          
          <div className="flex items-center justify-center space-x-2 mb-6">
            <div className={`w-3 h-3 rounded-full ${
              connected ? 'bg-green-500' : 'bg-red-500'
            }`}></div>
            <span className="text-sm text-gray-600">
              {connected ? 'Connected to server' : 'Disconnected from server'}
            </span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-red-800 text-sm">{error}</span>
                <button
                  onClick={clearError}
                  className="text-red-600 hover:text-red-800"
                >
                  ×
                </button>
              </div>
            </div>
          )}
          
          <div className="space-y-3">
            <button 
              className="w-full bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!connected}
              onClick={() => setCurrentView('games-list')}
            >
              Browse Games
            </button>
            <button 
              className="w-full bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!connected}
              onClick={() => setCurrentView('create-game')}
            >
              Create New Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Games List View
  if (currentView === 'games-list') {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={handleBackToMenu}
              className="text-gray-600 hover:text-gray-800 flex items-center"
            >
              <svg className="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              Back to Menu
            </button>
            <button
              onClick={() => setCurrentView('create-game')}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium"
            >
              Create New Game
            </button>
          </div>
          <GamesList onSelectGame={handleSelectGame} />
        </div>
      </div>
    );
  }

  // Create Game View
  if (currentView === 'create-game') {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => setCurrentView(currentGame ? 'game-lobby' : 'games-list')}
              className="text-gray-600 hover:text-gray-800 flex items-center"
            >
              <svg className="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              Back
            </button>
          </div>
          <CreateGame
            onGameCreated={handleGameCreated}
            onCancel={() => setCurrentView('games-list')}
          />
        </div>
      </div>
    );
  }

  // Game Lobby View
  if (currentView === 'game-lobby' && currentGame) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-6xl mx-auto">
          <GameLobby
            game={currentGame}
            onStartGame={handleStartGame}
            onBack={handleBackToGamesList}
          />
        </div>
      </div>
    );
  }

  // Game Board View
  if (currentView === 'game-board' && currentGame) {
    return (
      <GameBoard
        game={currentGame}
        onExitGame={handleBackToGamesList}
      />
    );
  }

  // Fallback
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg">
        <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
        <p className="text-gray-600">Something went wrong. Please refresh the page.</p>
      </div>
    </div>
  );
}

export default App;
