/**
 * Nations Table Component
 *
 * Detailed table displaying all players with diplomatic information.
 * Based on freeciv-web nation table implementation with modern design.
 *
 * Reference: reference/freeciv-web/freeciv-web/src/main/webapp/javascript/nation.js:35-147
 */

import React, { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../ui/Table';
import { PlayerRow } from './PlayerRow';
// import { cn } from '../../lib/utils';
import type { PlayerNationInfo } from '@shared/types/nations';

interface NationsTableProps {
  players: PlayerNationInfo[];
  selectedPlayerId: string | null;
  currentPlayerId: string | null;
  onPlayerSelect: (playerId: string | null) => void;
  isObserver: boolean;
}

export const NationsTable: React.FC<NationsTableProps> = ({
  players,
  selectedPlayerId,
  currentPlayerId,
  onPlayerSelect,
  isObserver,
}) => {
  const { nations } = useGameStore();

  // Filter out placeholder/unavailable players (like freeciv-web)
  const visiblePlayers = useMemo(() => {
    return players.filter(player => {
      // Skip players with invalid nations
      if (!nations[player.nationId]) return false;

      // Skip "New Available Player" entries in longturn games
      if (player.playerName.includes('New Available Player')) return false;

      return true;
    });
  }, [players, nations]);

  const handleRowClick = (playerId: string) => {
    if (selectedPlayerId === playerId) {
      // Deselect if clicking the same player
      onPlayerSelect(null);
    } else {
      onPlayerSelect(playerId);
    }
  };

  if (visiblePlayers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium">No players found</p>
          <p className="text-sm">Waiting for game to start...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Flag</TableHead>
            <TableHead className="w-8">Color</TableHead>
            <TableHead className="min-w-[120px]">Player Name</TableHead>
            <TableHead className="min-w-[100px]">Nation</TableHead>
            {!isObserver && <TableHead className="w-20">Attitude</TableHead>}
            <TableHead className="w-16">Score</TableHead>
            <TableHead className="w-20">Type</TableHead>
            <TableHead className="w-16">Status</TableHead>
            {!isObserver && (
              <>
                <TableHead className="w-24">Diplomatic State</TableHead>
                <TableHead className="w-20">Embassy</TableHead>
                <TableHead className="w-24">Shared Vision</TableHead>
              </>
            )}
            <TableHead className="w-16">Team</TableHead>
            <TableHead className="w-20">State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visiblePlayers.map(player => (
            <PlayerRow
              key={player.playerId}
              player={player}
              nation={nations[player.nationId]}
              isSelected={selectedPlayerId === player.playerId}
              isCurrentPlayer={currentPlayerId === player.playerId}
              isObserver={isObserver}
              onClick={() => handleRowClick(player.playerId)}
            />
          ))}
        </TableBody>
      </Table>

      {visiblePlayers.length > 10 && (
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
      )}
    </div>
  );
};
