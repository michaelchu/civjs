import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageBackground } from './shared/PageBackground';

export const GameCreationDialog: React.FC = () => {
  const [playerName, setPlayerName] = useState('');
  const [gameName, setGameName] = useState('');
  const [gameType, setGameType] = useState<'single' | 'multiplayer'>('single');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [mapSize, setMapSize] = useState('standard');
  const [error, setError] = useState('');

  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();

    if (!playerName.trim()) {
      setError('Please enter a player name');
      return;
    }

    if (!gameName.trim()) {
      setError('Please enter a game name');
      return;
    }

    // Navigate to terrain settings with game parameters
    navigate('/terrain-settings', {
      state: {
        playerName: playerName.trim(),
        gameName: gameName.trim(),
        gameType,
        maxPlayers: gameType === 'single' ? 1 : maxPlayers,
        mapSize,
      },
    });
  };

  const mapSizeOptions = [
    { value: 'small', label: 'Small (40x25)', description: '2-4 players' },
    {
      value: 'standard',
      label: 'Standard (80x50)',
      description: '4-6 players',
    },
    { value: 'large', label: 'Large (120x75)', description: '6-8 players' },
  ];

  return (
    <PageBackground
      className="min-h-[100dvh] md:flex md:items-center md:justify-center md:p-4"
    >
      <div className="flex flex-col h-[100dvh] md:h-auto md:max-w-2xl xl:max-w-3xl md:mx-auto">
        <div className="bg-transparent md:bg-card md:border md:border-border md:shadow-2xl p-4 md:p-8 md:rounded-lg w-full flex-1 md:flex-none overflow-y-auto">
          <div className="flex items-center mb-6">
            <button
              onClick={handleBack}
              className="mr-3 p-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div>
              <h2 className="text-2xl font-bold text-foreground">Create New Game</h2>
              <p className="text-muted-foreground">Set up your civilization</p>
            </div>
          </div>

          <form id="create-game-form" onSubmit={handleNext} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <label
                  htmlFor="playerName"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Your Name
                </label>
                <input
                  id="playerName"
                  type="text"
                  value={playerName}
                  onChange={e => setPlayerName(e.target.value)}
                  placeholder="Enter your player name"
                  className="w-full px-3 py-3 bg-card border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring shadow-sm"
                  maxLength={32}
                />
              </div>

              <div>
                <label
                  htmlFor="gameName"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Game Name
                </label>
                <input
                  id="gameName"
                  type="text"
                  value={gameName}
                  onChange={e => setGameName(e.target.value)}
                  placeholder="Enter game name"
                  className="w-full px-3 py-3 bg-card border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring shadow-sm"
                  maxLength={50}
                />
              </div>

              <div>
                <label
                  htmlFor="gameType"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Game Type
                </label>
                <select
                  id="gameType"
                  value={gameType}
                  onChange={e => setGameType(e.target.value as 'single' | 'multiplayer')}
                  className="w-full px-3 py-3 bg-card border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring shadow-sm"
                >
                  <option value="single">Single Player</option>
                  <option value="multiplayer" disabled>
                    Multiplayer (Coming Soon)
                  </option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  {gameType === 'single'
                    ? 'Play against AI opponents'
                    : 'Play with other human players online'}
                </p>
              </div>

              <div>
                <label htmlFor="mapSize" className="block text-sm font-medium text-foreground mb-2">
                  Map Size
                </label>
                <select
                  id="mapSize"
                  value={mapSize}
                  onChange={e => setMapSize(e.target.value)}
                  className="w-full px-3 py-3 bg-card border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring shadow-sm"
                >
                  {mapSizeOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {gameType === 'multiplayer' && (
              <div>
                <label
                  htmlFor="maxPlayers"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Max Players
                </label>
                <select
                  id="maxPlayers"
                  value={maxPlayers}
                  onChange={e => setMaxPlayers(Number(e.target.value))}
                  className="w-full px-3 py-3 bg-card border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring shadow-sm md:max-w-xs"
                >
                  <option value={2}>2 Players</option>
                  <option value={3}>3 Players</option>
                  <option value={4}>4 Players</option>
                  <option value={6}>6 Players</option>
                  <option value={8}>8 Players</option>
                </select>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
                {error}
              </div>
            )}

            <div className="hidden lg:flex space-x-4">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!playerName.trim() || !gameName.trim()}
                className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 text-primary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
              >
                Next
              </button>
            </div>
          </form>
        </div>

        {/* Mobile bottom buttons */}
        <div className="lg:hidden bg-card/50 p-4 border-t border-border">
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-game-form"
              disabled={!playerName.trim() || !gameName.trim()}
              className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 text-primary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </PageBackground>
  );
};
