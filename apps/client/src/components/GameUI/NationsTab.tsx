/**
 * Nations Tab Component
 *
 * Complete diplomatic interface for CivJS, porting functionality from:
 * reference/freeciv-web/freeciv-web/src/main/webapp/javascript/nation.js
 * reference/freeciv-web/freeciv-web/src/main/webapp/webclient/nations.jsp
 *
 * Features:
 * - Complete nations table with all diplomatic information
 * - Context-sensitive action buttons
 * - Real-time status updates
 * - Intelligence reports
 * - Modern shadcn/ui design
 */

import React, { useState, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { NationsTable } from './NationsTable';
import { DiplomaticActions } from './DiplomaticActions';
import { IntelligenceDialog } from './IntelligenceDialog';
// import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { Users, Crown, Bot, Skull, CheckCircle, Clock, Zap, BarChart3 } from 'lucide-react';
import type { PlayerNationInfo } from '../../../../server/src/shared/types/nations';

export const NationsTab: React.FC = () => {
  const {
    playerNations,
    selectedPlayerId,
    currentPlayerId,
    selectPlayer,
    // players
  } = useGameStore();

  const [showIntelligence, setShowIntelligence] = useState(false);

  // Calculate statistics (based on freeciv-web update_nation_screen)
  const statistics = useMemo(() => {
    const playerList = Object.values(playerNations);
    const totalPlayers = playerList.length;
    const humans = playerList.filter(
      p => p.isHuman && p.isAlive && (!p.turnsIdle || p.turnsIdle <= 4)
    ).length;
    const ais = playerList.filter(p => !p.isHuman && p.isAlive).length;
    const inactive = totalPlayers - humans - ais;

    return { totalPlayers, humans, ais, inactive };
  }, [playerNations]);

  // Sort players for display (matching freeciv-web table sorting)
  const sortedPlayers = useMemo(() => {
    const playerList = Object.values(playerNations);

    return playerList.sort((a, b) => {
      // Sort by player name by default (like freeciv-web sortList: [[2,0]])
      return a.playerName.localeCompare(b.playerName);
    });
  }, [playerNations]);

  const selectedPlayer = selectedPlayerId ? playerNations[selectedPlayerId] : null;
  const currentPlayer = currentPlayerId ? playerNations[currentPlayerId] : null;
  const isObserver = !currentPlayer;

  const handlePlayerSelect = (playerId: string | null) => {
    selectPlayer(playerId);
  };

  const handleViewPlayer = () => {
    if (selectedPlayer) {
      // TODO: Implement center_on_player functionality
      console.log('View player on map:', selectedPlayer.playerId);
    }
  };

  const handleShowIntelligence = () => {
    if (selectedPlayer) {
      setShowIntelligence(true);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Users className="w-6 h-6 text-blue-500" />
            <h2 className="text-2xl font-bold text-foreground">Nations of the World</h2>
          </div>

          {/* Statistics (based on freeciv-web nations_label) */}
          <div className="flex items-center space-x-4">
            <Badge variant="secondary" className="flex items-center space-x-1">
              <Crown className="w-3 h-3" />
              <span>Humans: {statistics.humans}</span>
            </Badge>
            <Badge variant="secondary" className="flex items-center space-x-1">
              <Bot className="w-3 h-3" />
              <span>AIs: {statistics.ais}</span>
            </Badge>
            <Badge variant="outline" className="flex items-center space-x-1">
              <Skull className="w-3 h-3" />
              <span>Inactive/Dead: {statistics.inactive}</span>
            </Badge>
          </div>
        </div>

        {/* Action Buttons Section */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">Diplomatic Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <DiplomaticActions
              selectedPlayer={selectedPlayer}
              currentPlayer={currentPlayer}
              isObserver={isObserver}
              onViewPlayer={handleViewPlayer}
              onShowIntelligence={handleShowIntelligence}
            />
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Main Nations Table */}
      <div className="flex-1 overflow-hidden">
        <Card className="h-full">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center space-x-2">
                <BarChart3 className="w-4 h-4" />
                <span>Diplomatic Overview</span>
              </CardTitle>

              {selectedPlayer && (
                <Badge variant="default" className="flex items-center space-x-1">
                  <span>Selected:</span>
                  <span className="font-medium">{selectedPlayer.playerName}</span>
                  <span className="text-xs">({selectedPlayer.nationAdjective})</span>
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 h-full">
            <div className="h-full overflow-auto">
              <NationsTable
                players={sortedPlayers}
                selectedPlayerId={selectedPlayerId}
                currentPlayerId={currentPlayerId}
                onPlayerSelect={handlePlayerSelect}
                isObserver={isObserver}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Intelligence Dialog */}
      {showIntelligence && selectedPlayer && (
        <IntelligenceDialog
          playerId={selectedPlayer.playerId}
          playerName={selectedPlayer.playerName}
          nationName={selectedPlayer.nationAdjective}
          open={showIntelligence}
          onOpenChange={setShowIntelligence}
        />
      )}
    </div>
  );
};

// Status indicator component for player states
export const PlayerStatusIndicator: React.FC<{
  status: PlayerNationInfo['status'];
  isOnline?: boolean;
  className?: string;
}> = ({ status, isOnline, className }) => {
  const getStatusInfo = () => {
    if (isOnline) {
      return {
        icon: <Zap className="w-3 h-3" />,
        text: 'Online',
        color: 'text-green-500 bg-green-50 border-green-200',
      };
    }

    switch (status) {
      case 'Done':
        return {
          icon: <CheckCircle className="w-3 h-3" />,
          text: 'Done',
          color: 'text-blue-500 bg-blue-50 border-blue-200',
        };
      case 'Moving':
        return {
          icon: <Clock className="w-3 h-3" />,
          text: 'Moving',
          color: 'text-amber-500 bg-amber-50 border-amber-200',
        };
      case 'Dead':
        return {
          icon: <Skull className="w-3 h-3" />,
          text: 'Dead',
          color: 'text-gray-500 bg-gray-50 border-gray-200',
        };
      default:
        return {
          icon: <Clock className="w-3 h-3" />,
          text: status,
          color: 'text-gray-500 bg-gray-50 border-gray-200',
        };
    }
  };

  const { icon, text, color } = getStatusInfo();

  return (
    <Badge variant="outline" className={`flex items-center space-x-1 ${color} ${className}`}>
      {icon}
      <span className="text-xs font-medium">{text}</span>
    </Badge>
  );
};
