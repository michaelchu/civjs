import React, { useState, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { Government } from '../../types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

interface RevolutionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentGovernment: Government | null;
}

interface GovernmentOption {
  id: string;
  government: Government;
  available: boolean;
  reason?: string;
  isCurrent: boolean;
}

export const RevolutionDialog: React.FC<RevolutionDialogProps> = ({
  isOpen,
  onClose,
  currentGovernment,
}) => {
  const { governments, technologies, getCurrentPlayer, startRevolution } = useGameStore();
  const [selectedGovernment, setSelectedGovernment] = useState<string | null>(null);

  const currentPlayer = getCurrentPlayer();

  // Helper function to map tech names to IDs
  const getTechIdFromName = (techName: string): string | null => {
    const techNameMap: Record<string, string> = {
      Monarchy: 'monarchy',
      'The Republic': 'the_republic',
      Communism: 'communism',
      Democracy: 'democracy',
    };
    return techNameMap[techName] || null;
  };

  // Mock researched technologies for now - in real implementation this would come from player data
  const researchedTechs = useMemo(() => {
    const researched = new Set(['alphabet', 'pottery']); // Basic starting techs

    // Add some mock researched techs for testing
    if (technologies && Object.keys(technologies).length > 0) {
      // In real implementation, this would be currentPlayer.technologies or similar
      researched.add('currency');
      researched.add('monarchy');
      researched.add('literature');
    }

    return researched;
  }, [technologies]);

  const governmentOptions: GovernmentOption[] = useMemo(() => {
    // Ensure governments is initialized before processing
    if (!governments || Object.keys(governments).length === 0) {
      return [];
    }

    return Object.entries(governments).map(([id, government]) => {
      const isCurrent = id === currentPlayer?.government;
      let available = true;
      let reason: string | undefined;

      // Check technology requirements
      if (government.reqs) {
        for (const req of government.reqs) {
          if (req.type === 'tech') {
            const techId = getTechIdFromName(req.name);
            if (techId && !researchedTechs.has(techId)) {
              available = false;
              reason = `Requires ${req.name} technology`;
              break;
            }
          }
        }
      }

      // Can't change to current government
      if (isCurrent) {
        available = false;
        reason = 'Current government';
      }

      return {
        id,
        government,
        available,
        reason,
        isCurrent,
      };
    });
  }, [governments, currentPlayer?.government, researchedTechs]);

  const getGovernmentIcon = (govId: string): string => {
    const icons: Record<string, string> = {
      anarchy: '⚡',
      despotism: '👑',
      monarchy: '👑',
      republic: '🏛️',
      communism: '🚩',
      democracy: '🗳️',
    };
    return icons[govId] || '🏛️';
  };

  const handleStartRevolution = () => {
    if (selectedGovernment) {
      startRevolution(selectedGovernment);
      onClose();
    }
  };

  const selectedGov = selectedGovernment ? governments[selectedGovernment] : null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-2xl text-white">Start a Revolution!</DialogTitle>
          <DialogDescription className="text-gray-300">
            Current form of government:{' '}
            <span className="font-semibold">{currentGovernment?.name || 'Unknown'}</span>
            <br />
            To start a revolution, select the new form of government:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 max-h-[400px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {governmentOptions.map(option => (
            <Card
              key={option.id}
              className={`cursor-pointer transition-all duration-200 ${
                option.isCurrent
                  ? 'bg-blue-900/50 border-blue-600'
                  : !option.available
                    ? 'bg-gray-800/50 border-gray-600 opacity-60 cursor-not-allowed'
                    : selectedGovernment === option.id
                      ? 'bg-green-800/50 border-green-500'
                      : 'bg-gray-800 border-gray-700 hover:bg-gray-700 hover:border-gray-600'
              }`}
              onClick={() => {
                if (option.available && !option.isCurrent) {
                  setSelectedGovernment(option.id);
                }
              }}
            >
              <div className="py-1.5 px-4">
                <div className="text-sm text-white flex items-center gap-2.5">
                  <span className="text-lg">{getGovernmentIcon(option.id)}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="font-medium">{option.government.name}</span>
                    {option.isCurrent && (
                      <span className="text-xs bg-blue-600 px-1.5 py-0.5 rounded">Current</span>
                    )}
                  </div>
                  {!option.available && option.reason && (
                    <span className="text-red-400 text-xs font-medium ml-auto">
                      {option.reason}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {selectedGov && (
          <div className="mt-6 p-6 bg-gray-800 rounded-lg border border-gray-700">
            <h4 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
              <span className="text-2xl">{getGovernmentIcon(selectedGovernment!)}</span>
              {selectedGov.name}
            </h4>
            <p className="text-gray-300 mb-4 leading-relaxed">{selectedGov.helptext}</p>

            <div className="text-sm text-gray-400">
              <p>
                <strong className="text-gray-300">Ruler Title:</strong>{' '}
                <span className="text-yellow-400">
                  {selectedGov.ruler_male_title.replace('%s', currentPlayer?.name || 'Leader')}
                </span>
              </p>
            </div>
          </div>
        )}

        {selectedGovernment && (
          <div className="text-center text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 mt-4">
            <div className="flex items-center justify-center gap-2">
              <span className="text-yellow-500">⚠️</span>
              <span className="font-medium">Warning: Your civilization will enter 3 turns of Anarchy during the revolution</span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-3 mt-6">
          <Button
            onClick={onClose}
            variant="outline"
            className="bg-gray-700 hover:bg-gray-600 border-gray-600 text-white px-6 py-2"
          >
            Cancel
          </Button>
          <Button
            onClick={handleStartRevolution}
            disabled={!selectedGovernment}
            className="bg-red-600 hover:bg-red-500 text-white disabled:bg-gray-600 disabled:text-gray-400 px-6 py-2"
          >
            Start Revolution!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
