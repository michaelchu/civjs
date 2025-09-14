import React, { useState, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { Government } from '../../types';
import {
  GameDialog,
  GameDialogContent,
  GameDialogDescription,
  GameDialogFooter,
  GameDialogHeader,
  GameDialogTitle,
} from '../ui/game-dialog';
import { GameButton } from '../ui/game-button';
import { Card } from '../ui/card';

interface GameRevolutionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentGovernment: Government | null;
  theme?: 'medieval' | 'futuristic' | 'parchment' | 'stone' | 'metal';
}

interface GovernmentOption {
  id: string;
  government: Government;
  available: boolean;
  reason?: string;
  isCurrent: boolean;
}

export const GameRevolutionDialog: React.FC<GameRevolutionDialogProps> = ({
  isOpen,
  onClose,
  currentGovernment,
  theme = 'medieval',
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

  // Theme-specific styling
  const getCardStyles = (option: GovernmentOption) => {
    const baseStyles = 'cursor-pointer transition-all duration-200 ';

    if (option.isCurrent) {
      return baseStyles + getThemeColors(theme, 'current');
    }

    if (!option.available) {
      return baseStyles + getThemeColors(theme, 'disabled');
    }

    if (selectedGovernment === option.id) {
      return baseStyles + getThemeColors(theme, 'selected');
    }

    return baseStyles + getThemeColors(theme, 'available');
  };

  const getThemeColors = (
    theme: 'medieval' | 'futuristic' | 'parchment' | 'stone' | 'metal',
    state: 'current' | 'disabled' | 'selected' | 'available'
  ) => {
    const themeColorMap: Record<typeof theme, Record<typeof state, string>> = {
      medieval: {
        current: 'bg-amber-200/20 border-amber-500',
        disabled: 'bg-amber-100/10 border-amber-700 opacity-60 cursor-not-allowed',
        selected: 'bg-green-200/20 border-green-600',
        available: 'bg-amber-100/5 border-amber-600 hover:bg-amber-200/10 hover:border-amber-500',
      },
      futuristic: {
        current: 'bg-cyan-400/20 border-cyan-400',
        disabled: 'bg-slate-800/50 border-slate-600 opacity-60 cursor-not-allowed',
        selected: 'bg-green-400/20 border-green-400',
        available:
          'bg-slate-800/30 border-cyan-500/30 hover:bg-slate-700/50 hover:border-cyan-400/50',
      },
      parchment: {
        current: 'bg-amber-100/30 border-amber-600',
        disabled: 'bg-amber-50/20 border-amber-700 opacity-60 cursor-not-allowed',
        selected: 'bg-green-100/30 border-green-700',
        available: 'bg-amber-50/10 border-amber-700 hover:bg-amber-100/20 hover:border-amber-600',
      },
      stone: {
        current: 'bg-gray-200/30 border-gray-600',
        disabled: 'bg-gray-100/20 border-gray-700 opacity-60 cursor-not-allowed',
        selected: 'bg-green-200/30 border-green-700',
        available: 'bg-gray-100/10 border-gray-700 hover:bg-gray-200/20 hover:border-gray-600',
      },
      metal: {
        current: 'bg-slate-300/30 border-slate-600',
        disabled: 'bg-slate-200/20 border-slate-700 opacity-60 cursor-not-allowed',
        selected: 'bg-green-300/30 border-green-600',
        available: 'bg-slate-200/10 border-slate-700 hover:bg-slate-300/20 hover:border-slate-600',
      },
    };

    return themeColorMap[theme]?.[state] || themeColorMap.medieval[state];
  };

  return (
    <GameDialog open={isOpen} onOpenChange={onClose}>
      <GameDialogContent theme={theme} size="lg" className="max-h-[90vh] overflow-y-auto">
        <GameDialogHeader>
          <GameDialogTitle theme={theme}>Start a Revolution!</GameDialogTitle>
          <GameDialogDescription theme={theme}>
            Current form of government:{' '}
            <span className="font-semibold">{currentGovernment?.name || 'Unknown'}</span>
            <br />
            To start a revolution, select the new form of government:
          </GameDialogDescription>
        </GameDialogHeader>

        <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
          {governmentOptions.map(option => (
            <Card
              key={option.id}
              className={getCardStyles(option)}
              onClick={() => {
                if (option.available && !option.isCurrent) {
                  setSelectedGovernment(option.id);
                }
              }}
            >
              <div className="py-3 px-4">
                <div className="text-sm flex items-center gap-3">
                  <span className="text-xl">{getGovernmentIcon(option.id)}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="font-medium">{option.government.name}</span>
                    {option.isCurrent && (
                      <span
                        className={`text-xs px-2 py-1 rounded font-medium ${
                          theme === 'futuristic'
                            ? 'bg-cyan-500/30 text-cyan-200'
                            : theme === 'medieval'
                              ? 'bg-amber-500/30 text-amber-800'
                              : 'bg-current/20'
                        }`}
                      >
                        Current
                      </span>
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
          <div
            className={`mt-6 p-6 rounded-lg border ${
              theme === 'medieval'
                ? 'bg-amber-50/50 border-amber-600/50'
                : theme === 'futuristic'
                  ? 'bg-slate-800/50 border-cyan-400/30'
                  : theme === 'parchment'
                    ? 'bg-amber-50/30 border-amber-600/30'
                    : theme === 'stone'
                      ? 'bg-gray-200/30 border-gray-600/30'
                      : theme === 'metal'
                        ? 'bg-slate-300/30 border-slate-600/30'
                        : 'bg-current/10 border-current/30'
            }`}
          >
            <h4 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <span className="text-2xl">{getGovernmentIcon(selectedGovernment!)}</span>
              {selectedGov.name}
            </h4>
            <p className="mb-4 leading-relaxed opacity-90">{selectedGov.helptext}</p>

            <div className="text-sm opacity-80">
              <p>
                <strong>Ruler Title:</strong>{' '}
                <span
                  className={`font-medium ${
                    theme === 'futuristic'
                      ? 'text-cyan-300'
                      : theme === 'medieval'
                        ? 'text-amber-700'
                        : ''
                  }`}
                >
                  {selectedGov.ruler_male_title.replace('%s', currentPlayer?.name || 'Leader')}
                </span>
              </p>
            </div>
          </div>
        )}

        {selectedGovernment && (
          <div
            className={`text-center text-sm rounded-lg p-4 mt-4 border-2 ${
              theme === 'medieval'
                ? 'bg-red-50/50 border-red-600/50 text-red-800'
                : theme === 'futuristic'
                  ? 'bg-red-900/30 border-red-400/50 text-red-300'
                  : theme === 'parchment'
                    ? 'bg-red-50/30 border-red-600/30 text-red-800'
                    : theme === 'stone'
                      ? 'bg-red-200/30 border-red-600/30 text-red-800'
                      : theme === 'metal'
                        ? 'bg-red-300/30 border-red-600/30 text-red-900'
                        : 'bg-red-500/20 border-red-500/50'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg">⚠️</span>
              <span className="font-medium">
                Warning: Your civilization will enter 3 turns of Anarchy during the revolution
              </span>
            </div>
          </div>
        )}

        <GameDialogFooter className="gap-3 mt-6">
          <GameButton theme={theme} variant="outline" onClick={onClose}>
            Cancel
          </GameButton>
          <GameButton
            theme={theme}
            variant="destructive"
            onClick={handleStartRevolution}
            disabled={!selectedGovernment}
          >
            Start Revolution!
          </GameButton>
        </GameDialogFooter>
      </GameDialogContent>
    </GameDialog>
  );
};
