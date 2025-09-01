/**
 * Player Row Component
 * 
 * Individual row in the nations table displaying all player/nation information.
 * Implements the complete freeciv-web player row functionality with modern design.
 * 
 * Reference: reference/freeciv-web/freeciv-web/src/main/webapp/javascript/nation.js:53-103
 */

import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { TableRow, TableCell } from '../ui/Table';
import { Badge } from '../ui/badge';
import { PlayerStatusIndicator } from './NationsTab';
import { FlagDisplay } from './FlagDisplay';
import { cn } from '../../lib/utils';
import { 
  Crown, 
  Bot, 
  Eye, 
  EyeOff, 
  Building2, 
  Handshake, 
  Swords, 
  Shield,
  Users
} from 'lucide-react';
import type { Nation, PlayerNationInfo, DiplomaticState } from '../../../shared/src/types/nations';

interface PlayerRowProps {
  player: PlayerNationInfo;
  nation: Nation;
  isSelected: boolean;
  isCurrentPlayer: boolean;
  isObserver: boolean;
  onClick: () => void;
}

export const PlayerRow: React.FC<PlayerRowProps> = ({
  player,
  nation,
  isSelected,
  isCurrentPlayer,
  isObserver,
  onClick
}) => {
  const {
    getPlayerDiplomaticState,
    getPlayerEmbassyStatus,
    getPlayerSharedVisionStatus
  } = useGameStore();

  // Get diplomatic information
  const diplomaticState = !isObserver ? getPlayerDiplomaticState(player.playerId) : null;
  const embassyStatus = !isObserver ? getPlayerEmbassyStatus(player.playerId) : null;
  const visionStatus = !isObserver ? getPlayerSharedVisionStatus(player.playerId) : null;

  // Determine row styling based on player state (like freeciv-web)
  const getRowClassName = () => {
    const baseClasses = "cursor-pointer transition-colors duration-200 hover:bg-muted/50";
    
    if (isSelected) {
      return cn(baseClasses, "bg-primary/10 border-primary/20");
    }
    
    if (isCurrentPlayer) {
      return cn(baseClasses, "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800");
    }
    
    if (!player.isAlive) {
      return cn(baseClasses, "bg-gray-50 dark:bg-gray-950/20 text-muted-foreground opacity-60");
    }
    
    if (!isObserver && diplomaticState === 'DS_WAR') {
      return cn(baseClasses, "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800");
    }
    
    return baseClasses;
  };

  const formatScore = (score: number) => {
    return score >= 0 ? score.toString() : '?';
  };

  const getAILevelText = (aiLevel?: string) => {
    return aiLevel || 'AI';
  };

  const getDiplomaticStateDisplay = (state: DiplomaticState | null) => {
    if (!state || state === 'DS_NO_CONTACT') return '-';
    
    const stateMap = {
      'DS_WAR': { text: 'War', icon: Swords, color: 'text-red-600 bg-red-50 border-red-200' },
      'DS_CEASEFIRE': { text: 'Ceasefire', icon: Shield, color: 'text-orange-600 bg-orange-50 border-orange-200' },
      'DS_ARMISTICE': { text: 'Armistice', icon: Shield, color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
      'DS_PEACE': { text: 'Peace', icon: Handshake, color: 'text-green-600 bg-green-50 border-green-200' },
      'DS_ALLIANCE': { text: 'Alliance', icon: Users, color: 'text-blue-600 bg-blue-50 border-blue-200' },
      'DS_TEAM': { text: 'Team', icon: Users, color: 'text-purple-600 bg-purple-50 border-purple-200' }
    };
    
    const info = stateMap[state];
    if (!info) return state;
    
    const Icon = info.icon;
    return (
      <Badge variant="outline" className={`flex items-center space-x-1 ${info.color}`}>
        <Icon className="w-3 h-3" />
        <span className="text-xs">{info.text}</span>
      </Badge>
    );
  };

  const getEmbassyDisplay = (hasEmbassy: boolean) => {
    if (hasEmbassy) {
      return (
        <Badge variant="outline" className="text-green-600 bg-green-50 border-green-200">
          <Building2 className="w-3 h-3 mr-1" />
          <span className="text-xs">Yes</span>
        </Badge>
      );
    }
    return <span className="text-muted-foreground text-xs">No</span>;
  };

  const getSharedVisionDisplay = () => {
    if (!visionStatus) return <span className="text-muted-foreground text-xs">None</span>;
    
    if (visionStatus.givingVision && visionStatus.receivingVision) {
      return (
        <Badge variant="outline" className="text-blue-600 bg-blue-50 border-blue-200">
          <Eye className="w-3 h-3 mr-1" />
          <span className="text-xs">Both ways</span>
        </Badge>
      );
    }
    
    if (visionStatus.receivingVision) {
      return (
        <Badge variant="outline" className="text-green-600 bg-green-50 border-green-200">
          <Eye className="w-3 h-3 mr-1" />
          <span className="text-xs">To you</span>
        </Badge>
      );
    }
    
    if (visionStatus.givingVision) {
      return (
        <Badge variant="outline" className="text-amber-600 bg-amber-50 border-amber-200">
          <EyeOff className="w-3 h-3 mr-1" />
          <span className="text-xs">To them</span>
        </Badge>
      );
    }
    
    return <span className="text-muted-foreground text-xs">None</span>;
  };

  const getPlayerState = () => {
    // Handle online status (would come from server updates)
    // For now, using the player status from the PlayerNationInfo
    
    if (player.status === 'Done' && !player.isHuman) {
      return <PlayerStatusIndicator status="Done" />;
    }
    
    if (!player.isHuman && player.turnsIdle && player.turnsIdle > 1) {
      return <span className="text-xs text-muted-foreground">Idle for {player.turnsIdle} turns</span>;
    }
    
    if (player.status === 'Moving' && !player.isHuman) {
      return <PlayerStatusIndicator status="Moving" />;
    }
    
    return <PlayerStatusIndicator status={player.status} />;
  };

  return (
    <TableRow className={getRowClassName()} onClick={onClick}>
      {/* Flag */}
      <TableCell>
        <FlagDisplay nationId={player.nationId} size="sm" />
      </TableCell>

      {/* Nation Color */}
      <TableCell>
        <div 
          className="w-6 h-6 rounded-sm border border-border"
          style={{ backgroundColor: player.nationColor }}
          title={`${nation.adjective} color`}
        />
      </TableCell>

      {/* Player Name */}
      <TableCell>
        <div className="flex items-center space-x-2">
          <span className={cn(
            "font-medium",
            isCurrentPlayer && "text-blue-600 dark:text-blue-400"
          )}>
            {player.playerName}
          </span>
          {isCurrentPlayer && (
            <Badge variant="outline" size="sm">You</Badge>
          )}
        </div>
      </TableCell>

      {/* Nation */}
      <TableCell>
        <span 
          className="cursor-help" 
          title={nation.legend}
        >
          {nation.adjective}
        </span>
      </TableCell>

      {/* Attitude (AI only, not for observers) */}
      {!isObserver && (
        <TableCell>
          <span className="text-sm">
            {player.attitude || '-'}
          </span>
        </TableCell>
      )}

      {/* Score */}
      <TableCell>
        <span className="font-mono text-sm">
          {formatScore(player.score)}
        </span>
      </TableCell>

      {/* AI/Human Type */}
      <TableCell>
        <div className="flex items-center space-x-1">
          {player.isHuman ? (
            <>
              <Crown className="w-3 h-3 text-amber-500" />
              <span className="text-xs">Human</span>
            </>
          ) : (
            <>
              <Bot className="w-3 h-3 text-blue-500" />
              <span className="text-xs">{getAILevelText(player.aiLevel)}</span>
            </>
          )}
        </div>
      </TableCell>

      {/* Alive/Dead Status */}
      <TableCell>
        <Badge variant={player.isAlive ? "default" : "secondary"} size="sm">
          {player.isAlive ? 'Alive' : 'Dead'}
        </Badge>
      </TableCell>

      {/* Diplomatic State (not for observers) */}
      {!isObserver && (
        <TableCell>
          {getDiplomaticStateDisplay(diplomaticState)}
        </TableCell>
      )}

      {/* Embassy (not for observers) */}
      {!isObserver && (
        <TableCell>
          {getEmbassyDisplay(embassyStatus?.hasEmbassy || false)}
        </TableCell>
      )}

      {/* Shared Vision (not for observers) */}
      {!isObserver && (
        <TableCell>
          {getSharedVisionDisplay()}
        </TableCell>
      )}

      {/* Team */}
      <TableCell>
        <Badge variant="outline" size="sm">
          {player.team + 1}
        </Badge>
      </TableCell>

      {/* Player State */}
      <TableCell>
        {getPlayerState()}
      </TableCell>
    </TableRow>
  );
};