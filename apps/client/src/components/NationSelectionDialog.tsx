import React, { useState } from 'react';
import { useNationSelection } from '../hooks/useNations';
import { Combobox } from './ui/combobox';
import { Button } from './ui/button';

interface NationSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedNation: string) => void;
  playerName: string;
  gameName?: string;
  loading?: boolean;
}

export const NationSelectionDialog: React.FC<NationSelectionDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  playerName,
  gameName,
  loading = false,
}) => {
  const [selectedNation, setSelectedNation] = useState('random');
  const { nations, loading: nationsLoading, error: nationsError } = useNationSelection('classic');

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedNation) {
      onConfirm(selectedNation);
    }
  };

  const nationOptions = [
    { value: 'random', label: 'Random' },
    ...nations.map(nation => ({
      value: nation.id,
      label: nation.name,
    })),
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-96 max-w-[90vw] border border-gray-700">
        <div className="p-6">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-white mb-2">Choose Your Nation</h2>
            <p className="text-gray-300 text-sm">
              Joining {gameName ? `"${gameName}"` : 'game'} as {playerName}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="nation" className="block text-sm font-medium text-gray-300 mb-2">
                Select your nation
              </label>
              <Combobox
                options={nationOptions}
                value={selectedNation}
                onValueChange={setSelectedNation}
                placeholder={nationsLoading ? 'Loading nations...' : 'Select your nation'}
                disabled={nationsLoading || loading}
              />
              {nationsError && (
                <p className="text-xs text-red-400 mt-1">
                  Failed to load nations. Using default selection.
                </p>
              )}
            </div>

            <div className="flex space-x-4 pt-4">
              <Button
                type="button"
                onClick={onClose}
                disabled={loading}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={!selectedNation || nationsLoading || loading}
                className="flex-1"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full mr-2"></div>
                    Joining...
                  </div>
                ) : (
                  'Join Game'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};