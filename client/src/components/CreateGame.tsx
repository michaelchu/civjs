import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { GameSettings } from '../../../shared/types';

interface CreateGameProps {
  onGameCreated: (gameId: string) => void;
  onCancel: () => void;
}

export default function CreateGame({ onGameCreated, onCancel }: CreateGameProps) {
  const { createGame, loading } = useGameStore();
  const [formData, setFormData] = useState({
    name: '',
    mapSize: 'medium' as GameSettings['mapSize'],
    turnTimer: 300,
    allowSpectators: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) return;

    const settings: GameSettings = {
      mapSize: formData.mapSize,
      turnTimer: formData.turnTimer,
      allowSpectators: formData.allowSpectators,
    };

    const game = await createGame(formData.name.trim(), settings);
    if (game) {
      onGameCreated(game.id);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Create New Game</h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Game Name */}
        <div>
          <label htmlFor="gameName" className="block text-sm font-medium text-gray-700 mb-2">
            Game Name
          </label>
          <input
            type="text"
            id="gameName"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            placeholder="Enter a name for your game"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
            disabled={loading}
          />
        </div>

        {/* Map Size */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Map Size
          </label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'small', label: 'Small', description: '40×40 tiles' },
              { value: 'medium', label: 'Medium', description: '60×60 tiles' },
              { value: 'large', label: 'Large', description: '80×80 tiles' },
            ].map((option) => (
              <label
                key={option.value}
                className={`relative flex flex-col p-4 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                  formData.mapSize === option.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="mapSize"
                  value={option.value}
                  checked={formData.mapSize === option.value}
                  onChange={(e) => handleInputChange('mapSize', e.target.value)}
                  className="sr-only"
                  disabled={loading}
                />
                <span className="text-sm font-medium text-gray-900">{option.label}</span>
                <span className="text-xs text-gray-500">{option.description}</span>
                {formData.mapSize === option.value && (
                  <div className="absolute top-2 right-2 text-blue-500">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Turn Timer */}
        <div>
          <label htmlFor="turnTimer" className="block text-sm font-medium text-gray-700 mb-2">
            Turn Timer (seconds)
          </label>
          <select
            id="turnTimer"
            value={formData.turnTimer}
            onChange={(e) => handleInputChange('turnTimer', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={loading}
          >
            <option value={60}>1 minute</option>
            <option value={180}>3 minutes</option>
            <option value={300}>5 minutes</option>
            <option value={600}>10 minutes</option>
            <option value={1800}>30 minutes</option>
          </select>
        </div>

        {/* Allow Spectators */}
        <div>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.allowSpectators}
              onChange={(e) => handleInputChange('allowSpectators', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={loading}
            />
            <span className="ml-2 text-sm text-gray-700">Allow spectators</span>
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Let other players watch your game without participating
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            disabled={loading || !formData.name.trim()}
          >
            {loading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            )}
            Create Game
          </button>
        </div>
      </form>
    </div>
  );
}
