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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

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

  const getTechIdFromName = (techName: string): string | null => {
    const techNameMap: Record<string, string> = {
      Monarchy: 'monarchy',
      'The Republic': 'the_republic',
      Communism: 'communism',
      Democracy: 'democracy',
    };
    return techNameMap[techName] || null;
  };

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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-2xl text-white">Start a Revolution!</DialogTitle>
          <DialogDescription className="text-gray-300">
            Current form of government:{' '}
            <span className="font-semibold">{currentGovernment?.name || 'Unknown'}</span>
            <br />
            To start a revolution, select the new form of government:
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
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
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <span className="text-xl">{getGovernmentIcon(option.id)}</span>
                  {option.government.name}
                  {option.isCurrent && (
                    <span className="text-xs bg-blue-600 px-2 py-1 rounded">Current</span>
                  )}
                </CardTitle>
                {!option.available && option.reason && (
                  <CardDescription className="text-red-400 text-sm">
                    {option.reason}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-300 text-sm line-clamp-3">{option.government.helptext}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {selectedGov && (
          <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <h4 className="text-lg font-semibold text-white mb-2">
              {getGovernmentIcon(selectedGovernment!)} {selectedGov.name}
            </h4>
            <p className="text-gray-300 mb-3">{selectedGov.helptext}</p>

            <div className="text-sm text-gray-400">
              <p>
                <strong>Ruler Title:</strong>{' '}
                {selectedGov.ruler_male_title.replace('%s', currentPlayer?.name || 'Leader')}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            onClick={onClose}
            variant="outline"
            className="bg-gray-700 hover:bg-gray-600 border-gray-600 text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={handleStartRevolution}
            disabled={!selectedGovernment}
            className="bg-red-600 hover:bg-red-500 text-white disabled:bg-gray-600 disabled:text-gray-400"
          >
            Start Revolution!
          </Button>
        </DialogFooter>

        {selectedGovernment && (
          <div className="text-center text-sm text-yellow-400 border-t border-gray-700 pt-3">
            ⚠️ Warning: Your civilization will enter 3 turns of Anarchy during the revolution
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
