import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SERVER_URL } from '../config';
import { PageBackground } from './shared/PageBackground';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();

  const handleStartNewGame = () => {
    navigate('/create-game');
  };

  const handleBrowseGames = () => {
    navigate('/browse-games');
  };

  return (
    <PageBackground className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-transparent md:bg-gradient-to-b md:from-amber-100 md:to-yellow-100 p-6 md:p-8 md:rounded-lg md:shadow-2xl w-full max-w-md mx-auto md:border md:border-amber-300 md:shadow-amber-300/20">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-amber-800 mb-4">CivJS</h1>
          <p className="text-amber-600 text-lg">A modern Civilization game</p>
          <p className="text-amber-500 text-sm mt-2">
            Build your empire, research technologies, and conquer the world
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleStartNewGame}
            className="w-full py-4 px-6 bg-amber-700 hover:bg-amber-800 text-amber-50 font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-amber-100 shadow-lg"
          >
            <div className="flex items-center justify-center">
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
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Start New Game
            </div>
          </button>

          <button
            onClick={handleBrowseGames}
            className="w-full py-4 px-6 bg-amber-800 hover:bg-amber-900 text-amber-50 font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-700 focus:ring-offset-2 focus:ring-offset-amber-100 shadow-lg"
          >
            <div className="flex items-center justify-center">
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
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Browse Games
            </div>
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-amber-400">
          <div className="text-xs text-amber-500 text-center">
            <p>Server: {SERVER_URL}</p>
            <p className="mt-1">Welcome to the world of civilization!</p>
          </div>
        </div>
      </div>
    </PageBackground>
  );
};
