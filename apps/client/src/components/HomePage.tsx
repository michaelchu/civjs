import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SERVER_URL } from '../config';
import { PageBackground } from './shared/PageBackground';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { gameClient } from '../services/GameClient';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [isQuickStarting, setIsQuickStarting] = useState(false);
  const [quickStartError, setQuickStartError] = useState('');

  const handleStartNewGame = () => {
    navigate('/create-game');
  };

  const handleBrowseGames = () => {
    navigate('/browse-games');
  };

  const generateTestHash = (): string => {
    const array = new Uint8Array(3);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  };

  const handleQuickStart = async () => {
    setIsQuickStarting(true);
    setQuickStartError('');

    try {
      await gameClient.connect();

      const hash = generateTestHash();
      const gameData = {
        gameName: `test-${hash}`,
        playerName: `test-${hash}`,
        gameType: 'single' as const,
        maxPlayers: 4,
        mapSize: 'standard',
        selectedNation: 'random',
        terrainSettings: {
          generator: 'random',
          landmass: 'normal',
          huts: 15,
          temperature: 50,
          wetness: 50,
          rivers: 50,
          resources: 'normal',
        },
      };

      const gameId = await gameClient.createGame(gameData);
      navigate(`/game/${gameId}`);
    } catch (err) {
      console.error('Quick start error:', err);
      setQuickStartError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setIsQuickStarting(false);
    }
  };

  return (
    <PageBackground className="min-h-screen flex items-center justify-center p-4">
      <Card className="bg-transparent md:bg-card w-full max-w-md mx-auto md:shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl font-bold">CivJS</CardTitle>
          <CardDescription className="text-lg">A modern Civilization game</CardDescription>
          <CardDescription className="text-sm mt-2">
            Build your empire, research technologies, and conquer the world
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <button
            onClick={handleStartNewGame}
            className="w-full py-4 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-lg"
          >
            <div className="flex items-center justify-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Start New Game
            </div>
          </button>

          <button
            onClick={handleQuickStart}
            disabled={isQuickStarting}
            className="w-full py-4 px-6 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/50 text-black font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-lg"
          >
            <div className="flex items-center justify-center">
              {isQuickStarting ? (
                <>
                  <div className="animate-spin w-5 h-5 mr-2 border-2 border-black/30 border-t-transparent rounded-full"></div>
                  Creating Game...
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Quick Start
                </>
              )}
            </div>
          </button>

          {quickStartError && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
              {quickStartError}
            </div>
          )}

          <button
            onClick={handleBrowseGames}
            className="w-full py-4 px-6 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-lg"
          >
            <div className="flex items-center justify-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Browse Games
            </div>
          </button>
        </CardContent>

        <CardFooter className="border-t border-border justify-center">
          <div className="text-xs text-muted-foreground text-center">
            <p>Server: {SERVER_URL}</p>
            <p className="mt-1">Welcome to the world of civilization!</p>
          </div>
        </CardFooter>
      </Card>
    </PageBackground>
  );
};
