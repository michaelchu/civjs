/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { type ColumnDef } from '@tanstack/react-table';

interface GameInfo {
  id: string;
  name: string;
  hostName: string;
  status: 'waiting' | 'starting' | 'active' | 'paused' | 'finished';
  currentPlayers: number;
  maxPlayers: number;
  currentTurn: number;
  mapSize: string;
  createdAt: string;
  canJoin: boolean;
}

interface GameActionsProps {
  game: GameInfo;
  onJoinGame: (gameId: string) => void;
  onDeleteGame: (gameId: string) => void;
  joiningGameId: string | null;
  deletingGameId: string | null;
}

const GameActions: React.FC<GameActionsProps> = ({
  game,
  onJoinGame,
  onDeleteGame,
  joiningGameId,
  deletingGameId,
}) => {
  return (
    <div className="flex justify-end gap-2">
      <button
        onClick={() => onJoinGame(game.id)}
        disabled={!game.canJoin || joiningGameId === game.id}
        className="px-3 py-1 bg-amber-700 hover:bg-amber-800 disabled:bg-amber-400 disabled:text-amber-200 text-amber-50 text-sm font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-amber-600"
      >
        {joiningGameId === game.id ? (
          <div className="flex items-center">
            <div className="animate-spin w-3 h-3 border border-amber-300 border-t-transparent rounded-full mr-1"></div>
            Joining...
          </div>
        ) : (
          'Join'
        )}
      </button>
      <button
        onClick={() => onDeleteGame(game.id)}
        disabled={deletingGameId === game.id}
        className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
        title="Delete Game"
      >
        {deletingGameId === game.id ? (
          <div className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full"></div>
        ) : (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
    </div>
  );
};

const StatusBadge: React.FC<{ status: GameInfo['status'] }> = ({ status }) => {
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'waiting':
        return 'Waiting for Players';
      case 'starting':
        return 'Starting';
      case 'active':
        return 'In Progress';
      case 'paused':
        return 'Paused';
      case 'finished':
        return 'Finished';
      default:
        return status;
    }
  };

  return (
    <span
      className={`text-xs font-medium px-2 py-1 rounded-full text-white ${
        status === 'waiting'
          ? 'bg-yellow-500'
          : status === 'active'
            ? 'bg-green-500'
            : status === 'paused'
              ? 'bg-orange-500'
              : status === 'finished'
                ? 'bg-gray-500'
                : 'bg-blue-500'
      }`}
    >
      {getStatusLabel(status)}
    </span>
  );
};

export const createGameColumns = (
  onJoinGame: (gameId: string) => void,
  onDeleteGame: (gameId: string) => void,
  joiningGameId: string | null,
  deletingGameId: string | null
): ColumnDef<GameInfo>[] => [
  {
    accessorKey: 'name',
    header: 'Game Name',
    cell: ({ row }) => <div className="font-semibold text-amber-800">{row.getValue('name')}</div>,
  },
  {
    accessorKey: 'hostName',
    header: 'Host',
    cell: ({ row }) => <div>{row.getValue('hostName')}</div>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const game = row.original;
      return (
        <div className="flex items-center gap-2">
          <StatusBadge status={row.getValue('status')} />
          {!game.canJoin && (
            <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full">Full</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'currentPlayers',
    header: 'Players',
    cell: ({ row }) => {
      const game = row.original;
      return (
        <div>
          {game.currentPlayers}/{game.maxPlayers}
        </div>
      );
    },
  },
  {
    accessorKey: 'currentTurn',
    header: 'Turn',
    cell: ({ row }) => <div>{row.getValue('currentTurn')}</div>,
  },
  {
    accessorKey: 'mapSize',
    header: 'Map Size',
    cell: ({ row }) => <div className="capitalize">{row.getValue('mapSize')}</div>,
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt'));
      return <div>{date.toLocaleDateString()}</div>;
    },
    sortingFn: 'datetime',
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <GameActions
        game={row.original}
        onJoinGame={onJoinGame}
        onDeleteGame={onDeleteGame}
        joiningGameId={joiningGameId}
        deletingGameId={deletingGameId}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
];

export type { GameInfo };
