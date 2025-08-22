import React, { useState } from 'react';
import { useGameStore } from '../store/gameStore';

export const HomePage: React.FC = () => {
  const { setClientState } = useGameStore();

  const handleStartNewGame = () => {
    setClientState('creating_game');
  };

  const handleBrowseGames = () => {
    setClientState('browsing_games');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-96 border border-gray-700">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">CivJS</h1>
          <p className="text-gray-300 text-lg">A modern Civilization game</p>
          <p className="text-gray-400 text-sm mt-2">Build your empire, research technologies, and conquer the world</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleStartNewGame}
            className="w-full py-4 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 shadow-lg"
          >
            <div className="flex items-center justify-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Start New Game
            </div>
          </button>

          <button
            onClick={handleBrowseGames}
            className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 shadow-lg"
          >
            <div className="flex items-center justify-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Browse Games
            </div>
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-700">
          <div className="text-xs text-gray-400 text-center">
            <p>Server: {import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'}</p>
            <p className="mt-1">Welcome to the world of civilization!</p>
          </div>
        </div>
      </div>
    </div>
  );
};