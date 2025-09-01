/**
 * Diplomatic Actions Component
 * 
 * Context-sensitive action buttons for the Nations tab.
 * Based on freeciv-web select_a_nation() and button enable/disable logic.
 * 
 * Reference: reference/freeciv-web/freeciv-web/src/main/webapp/javascript/nation.js:225-311
 */

import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../ui/button';
import { 
  Eye, 
  MessageSquare, 
  Handshake, 
  Swords, 
  Building2, 
  BarChart3, 
  UserCheck, 
  Bot,
  EyeOff,
  Crown
} from 'lucide-react';
import type { PlayerNationInfo, DiplomaticState } from '../../../shared/src/types/nations';

interface DiplomaticActionsProps {
  selectedPlayer: PlayerNationInfo | null;
  currentPlayer: PlayerNationInfo | null;
  isObserver: boolean;
  onViewPlayer: () => void;
  onShowIntelligence: () => void;
}

export const DiplomaticActions: React.FC<DiplomaticActionsProps> = ({
  selectedPlayer,
  currentPlayer,
  isObserver,
  onViewPlayer,
  onShowIntelligence
}) => {
  const {
    getPlayerDiplomaticState,
    getPlayerEmbassyStatus,
    getPlayerSharedVisionStatus
  } = useGameStore();

  if (!selectedPlayer) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <div className="text-center">
          <Crown className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a player to view diplomatic actions</p>
        </div>
      </div>
    );
  }

  const diplomaticState = !isObserver ? getPlayerDiplomaticState(selectedPlayer.playerId) : null;
  const embassyStatus = !isObserver ? getPlayerEmbassyStatus(selectedPlayer.playerId) : null;
  const visionStatus = !isObserver ? getPlayerSharedVisionStatus(selectedPlayer.playerId) : null;

  const isSelectedMyself = currentPlayer && selectedPlayer.playerId === currentPlayer.playerId;
  const bothAliveAndDifferent = currentPlayer && 
    selectedPlayer.playerId !== currentPlayer.playerId &&
    selectedPlayer.isAlive && 
    currentPlayer.isAlive;

  // Button enable/disable logic based on freeciv-web select_a_nation()
  const canViewPlayer = selectedPlayer.isAlive && (
    isObserver || 
    isSelectedMyself || 
    (diplomaticState !== null && diplomaticState !== 'DS_NO_CONTACT')
  );

  const canMeetPlayer = !isObserver && 
    bothAliveAndDifferent && 
    diplomaticState !== null && 
    diplomaticState !== 'DS_NO_CONTACT';

  const canSendMessage = !selectedPlayer.isHuman || isSelectedMyself ? false : true;

  const canCancelTreaty = !isObserver && 
    bothAliveAndDifferent && 
    currentPlayer && 
    selectedPlayer.team !== currentPlayer.team &&
    diplomaticState !== null &&
    diplomaticState !== 'DS_WAR' && 
    diplomaticState !== 'DS_NO_CONTACT';

  const canWithdrawVision = !isObserver && 
    bothAliveAndDifferent && 
    currentPlayer &&
    selectedPlayer.team !== currentPlayer.team &&
    visionStatus?.givingVision;

  const canShowIntelligence = isObserver || (
    bothAliveAndDifferent && diplomaticState !== 'DS_NO_CONTACT'
  );

  const canTakePlayer = !isObserver && 
    isObserver && 
    !selectedPlayer.isHuman && 
    selectedPlayer.isAlive;

  const getTreatyButtonText = () => {
    if (diplomaticState === 'DS_CEASEFIRE' || 
        diplomaticState === 'DS_ARMISTICE' || 
        diplomaticState === 'DS_PEACE') {
      return 'Declare War';
    }
    return 'Cancel Treaty';
  };

  const handleMeetPlayer = () => {
    if (selectedPlayer) {
      console.log('Initiate diplomacy meeting with:', selectedPlayer.playerId);
      // TODO: Implement diplomacy_init_meeting_req
    }
  };

  const handleSendMessage = () => {
    if (selectedPlayer) {
      console.log('Send private message to:', selectedPlayer.playerId);
      // TODO: Implement show_send_private_message_dialog
    }
  };

  const handleCancelTreaty = () => {
    if (selectedPlayer) {
      console.log('Cancel treaty with:', selectedPlayer.playerId);
      // TODO: Implement diplomacy_cancel_treaty
    }
  };

  const handleWithdrawVision = () => {
    if (selectedPlayer) {
      console.log('Withdraw shared vision from:', selectedPlayer.playerId);
      // TODO: Implement withdraw_vision_clicked
    }
  };

  const handleTakePlayer = () => {
    if (selectedPlayer) {
      console.log('Take control of player:', selectedPlayer.playerId);
      // TODO: Implement take_player
    }
  };

  const handleToggleAI = () => {
    if (selectedPlayer) {
      console.log('Toggle AI for player:', selectedPlayer.playerId);
      // TODO: Implement aitoggle_player
    }
  };

  const handleShowScores = () => {
    console.log('Show game scores');
    // TODO: Implement game scores dialog
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
      {/* View Player */}
      <Button
        variant="outline"
        size="sm"
        disabled={!canViewPlayer}
        onClick={onViewPlayer}
        className="flex items-center space-x-2"
      >
        <Eye className="w-4 h-4" />
        <span>View on Map</span>
      </Button>

      {/* Meet Player */}
      <Button
        variant="outline"
        size="sm"
        disabled={!canMeetPlayer}
        onClick={handleMeetPlayer}
        className="flex items-center space-x-2"
      >
        <Handshake className="w-4 h-4" />
        <span>Meet Player</span>
      </Button>

      {/* Cancel Treaty / Declare War */}
      <Button
        variant={diplomaticState === 'DS_PEACE' ? "destructive" : "outline"}
        size="sm"
        disabled={!canCancelTreaty}
        onClick={handleCancelTreaty}
        className="flex items-center space-x-2"
      >
        <Swords className="w-4 h-4" />
        <span>{getTreatyButtonText()}</span>
      </Button>

      {/* Withdraw Vision */}
      <Button
        variant="outline"
        size="sm"
        disabled={!canWithdrawVision}
        onClick={handleWithdrawVision}
        className="flex items-center space-x-2"
      >
        <EyeOff className="w-4 h-4" />
        <span>Withdraw Vision</span>
      </Button>

      {/* Send Message */}
      <Button
        variant="outline"
        size="sm"
        disabled={!canSendMessage}
        onClick={handleSendMessage}
        className="flex items-center space-x-2"
      >
        <MessageSquare className="w-4 h-4" />
        <span>Send Message</span>
      </Button>

      {/* Intelligence Report */}
      <Button
        variant="outline"
        size="sm"
        disabled={!canShowIntelligence}
        onClick={onShowIntelligence}
        className="flex items-center space-x-2"
      >
        <Building2 className="w-4 h-4" />
        <span>Intelligence</span>
      </Button>

      {/* Game Scores */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleShowScores}
        className="flex items-center space-x-2"
      >
        <BarChart3 className="w-4 h-4" />
        <span>Game Scores</span>
      </Button>

      {/* Take Player (Observer only) */}
      {isObserver && (
        <Button
          variant="outline"
          size="sm"
          disabled={!canTakePlayer}
          onClick={handleTakePlayer}
          className="flex items-center space-x-2"
        >
          <UserCheck className="w-4 h-4" />
          <span>Take Player</span>
        </Button>
      )}

      {/* Toggle AI (Admin/Observer) */}
      {isObserver && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleToggleAI}
          className="flex items-center space-x-2"
        >
          <Bot className="w-4 h-4" />
          <span>Toggle AI</span>
        </Button>
      )}
    </div>
  );
};