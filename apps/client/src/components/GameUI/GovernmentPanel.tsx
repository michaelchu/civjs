import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { RevolutionDialog } from '../Dialogs/RevolutionDialog';

export const GovernmentPanel: React.FC = () => {
  const { governments, getCurrentPlayer } = useGameStore();
  const [isRevolutionDialogOpen, setIsRevolutionDialogOpen] = useState(false);

  const currentPlayer = getCurrentPlayer();
  const currentGovernment =
    currentPlayer && governments ? governments[currentPlayer.government] : null;
  const isInRevolution = currentPlayer && (currentPlayer.revolutionTurns || 0) > 0;

  if (!currentPlayer) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4 text-white">Government</h2>
        <p className="text-gray-400">Loading player data...</p>
      </div>
    );
  }

  const getRulerTitle = (): string => {
    if (!currentGovernment) return currentPlayer.name;

    // For demo purposes, assume male leader - in real game this would come from nation/leader data
    const titleTemplate = currentGovernment.ruler_male_title;
    return titleTemplate.replace('%s', currentPlayer.name);
  };

  const getGovernmentDescription = (): string => {
    if (isInRevolution) {
      return `Your civilization is in a state of Anarchy! ${currentPlayer.revolutionTurns} turns remaining until your new government is established.`;
    }

    return currentGovernment?.helptext || 'No government information available.';
  };

  const getGovernmentEffects = (): string[] => {
    if (!currentGovernment) return [];

    const effects: string[] = [];

    switch (currentGovernment.id) {
      case 'anarchy':
        effects.push('• High corruption and waste');
        effects.push('• No organized taxation');
        effects.push('• Citizens focused on survival');
        break;
      case 'despotism':
        effects.push('• High corruption');
        effects.push('• Martial law maintains order');
        effects.push('• Military units provide happiness');
        break;
      case 'monarchy':
        effects.push('• Moderate corruption');
        effects.push('• Hereditary rule provides stability');
        effects.push('• Better than despotism for trade');
        break;
      case 'republic':
        effects.push('• Low corruption');
        effects.push('• High trade potential');
        effects.push('• Citizens easily become unhappy');
        break;
      case 'communism':
        effects.push('• Uniform corruption everywhere');
        effects.push('• State control of resources');
        effects.push('• No distance penalty for corruption');
        break;
      case 'democracy':
        effects.push('• No corruption');
        effects.push('• Maximum trade benefits');
        effects.push('• War causes severe unhappiness');
        break;
    }

    return effects;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Government</h2>
        <Button
          onClick={() => setIsRevolutionDialogOpen(true)}
          variant="outline"
          disabled={isInRevolution}
          className="bg-gray-700 hover:bg-gray-600 border-gray-600 text-white"
        >
          {isInRevolution ? 'Revolution in Progress...' : 'Start Revolution'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Government Card */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-xl text-white flex items-center gap-3">
              <span className="text-2xl">🏛️</span>
              {currentGovernment?.name || 'Unknown Government'}
              {isInRevolution && (
                <span className="text-sm bg-red-600 px-2 py-1 rounded">Revolution</span>
              )}
            </CardTitle>
            <CardDescription className="text-gray-300">{getRulerTitle()}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-gray-300 mb-4">{getGovernmentDescription()}</p>

            {isInRevolution && (
              <div className="bg-red-900/30 border border-red-700 rounded p-3 mb-4">
                <p className="text-red-300 font-semibold">⚡ Revolution in Progress</p>
                <p className="text-red-200 text-sm">
                  {currentPlayer.revolutionTurns} turns of Anarchy remaining
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Government Effects Card */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-lg text-white">Government Effects</CardTitle>
            <CardDescription className="text-gray-400">
              Current bonuses and penalties
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {getGovernmentEffects().map((effect, index) => (
                <p key={index} className="text-gray-300 text-sm">
                  {effect}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Government Stats */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-lg text-white">Civilization Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-400">{currentPlayer.gold}</p>
              <p className="text-gray-400 text-sm">Gold</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-400">{currentPlayer.science}</p>
              <p className="text-gray-400 text-sm">Science</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-400">0</p>
              <p className="text-gray-400 text-sm">Trade</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-400">0</p>
              <p className="text-gray-400 text-sm">Culture</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revolution Dialog */}
      <RevolutionDialog
        isOpen={isRevolutionDialogOpen}
        onClose={() => setIsRevolutionDialogOpen(false)}
        currentGovernment={currentGovernment}
      />
    </div>
  );
};
