import React from 'react';
import { BarChart3, Trophy } from 'lucide-react';
import type { Player } from '../../types';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { HudDialogContent } from './HudDialogContent';
import { NationInsignia } from './NationInsignia';

export interface ScoreSnapshot {
  turn: number;
  scores: Record<string, number>;
}

interface ScoreReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Record<string, Player>;
  currentPlayerId: string;
  history: ScoreSnapshot[];
  cityCounts: Record<string, number>;
}

const palette = ['#67e8f9', '#c4b5fd', '#fbbf24', '#86efac', '#fda4af', '#93c5fd'];
type ScorePoint = number | null;

const formatNation = (nation: string): string =>
  nation
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const ScoreChart: React.FC<{
  players: Array<{ id: string; name: string; color: string; scores: ScorePoint[] }>;
  turns: number[];
}> = ({ players, turns }) => {
  const width = 720;
  const height = 250;
  const padding = { top: 20, right: 24, bottom: 34, left: 42 };
  const values = players
    .flatMap(player => player.scores)
    .filter((score): score is number => score !== null);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(max - min, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xFor = (index: number) =>
    padding.left + (turns.length <= 1 ? plotWidth / 2 : (index / (turns.length - 1)) * plotWidth);
  const yFor = (value: number) => padding.top + ((max - value) / range) * plotHeight;
  const gridValues = [max, min + range / 2, min];

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/50 p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[34rem] w-full"
        role="img"
        aria-label="Historical score chart"
      >
        {gridValues.map((value, index) => {
          const y = yFor(value);
          return (
            <g key={`grid-${index}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="rgba(148,163,184,0.18)"
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11">
                {Math.round(value)}
              </text>
            </g>
          );
        })}
        <line
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={height - padding.bottom}
          stroke="rgba(148,163,184,0.35)"
        />
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          stroke="rgba(148,163,184,0.35)"
        />
        {turns.map((turn, index) => (
          <text
            key={turn}
            x={xFor(index)}
            y={height - 10}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="11"
          >
            T{turn}
          </text>
        ))}
        {players.map(player => {
          const segments: string[][] = [];
          let segment: string[] = [];
          player.scores.forEach((score, index) => {
            if (score === null) {
              if (segment.length > 0) segments.push(segment);
              segment = [];
              return;
            }
            segment.push(`${xFor(index)},${yFor(score)}`);
          });
          if (segment.length > 0) segments.push(segment);
          return (
            <g key={player.id}>
              {segments.map(
                (points, index) =>
                  points.length > 1 && (
                    <polyline
                      key={`${player.id}-segment-${index}`}
                      points={points.join(' ')}
                      fill="none"
                      stroke={player.color}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )
              )}
              {player.scores.map((score, index) =>
                score === null ? null : (
                  <circle
                    key={`${player.id}-${turns[index]}`}
                    cx={xFor(index)}
                    cy={yFor(score)}
                    r="4"
                    fill={player.color}
                  >
                    <title>{`${player.name}: ${score} at turn ${turns[index]}`}</title>
                  </circle>
                )
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-2 text-[10px] text-slate-400">
        {players.map(player => (
          <span key={player.id} className="inline-flex items-center gap-1.5">
            <NationInsignia color={player.color} name={player.name} size="sm" shape="dot" />
            {player.name}
          </span>
        ))}
      </div>
    </div>
  );
};

export const ScoreReport: React.FC<ScoreReportProps> = ({
  open,
  onOpenChange,
  players,
  currentPlayerId,
  history,
  cityCounts,
}) => {
  const standings = Object.values(players)
    .filter(player => player.score !== undefined)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  const turns = history.map(snapshot => snapshot.turn);
  const chartPlayers = standings.map((player, index) => ({
    id: player.id,
    name: player.name || formatNation(player.nation),
    color: player.color || palette[index % palette.length],
    scores: history.map(snapshot => snapshot.scores[player.id] ?? null),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <HudDialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <BarChart3 className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Scores and history
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Current civilization standings with score snapshots captured during this session.
          </DialogDescription>
        </DialogHeader>

        {standings.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
            Score data is not available yet.
          </div>
        ) : (
          <div className="space-y-5">
            <section aria-labelledby="score-history-heading">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 id="score-history-heading" className="text-sm font-semibold text-slate-100">
                  Score history
                </h3>
                <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  {history.length > 1
                    ? `${history.length} turns captured`
                    : 'Waiting for another turn'}
                </span>
              </div>
              {history.length > 0 ? (
                <ScoreChart players={chartPlayers} turns={turns} />
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/5 p-6 text-sm text-slate-400">
                  <BarChart3 className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  The chart will populate as authoritative score updates arrive.
                </div>
              )}
            </section>

            <section aria-labelledby="score-standings-heading">
              <div className="mb-2 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" />
                <h3 id="score-standings-heading" className="text-sm font-semibold text-slate-100">
                  Current standings
                </h3>
              </div>
              <Table className="border-white/10">
                <TableHeader className="bg-slate-800">
                  <TableRow className="border-white/10 hover:bg-slate-800">
                    <TableHead className="text-slate-300">Rank</TableHead>
                    <TableHead className="text-slate-300">Civilization</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                    <TableHead className="text-right text-slate-300">Score</TableHead>
                    <TableHead className="text-right text-slate-300">Culture</TableHead>
                    <TableHead className="text-right text-slate-300">Known cities</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standings.map((player, index) => {
                    return (
                      <TableRow
                        key={player.id}
                        className={
                          player.id === currentPlayerId ? 'bg-cyan-400/10' : 'border-white/10'
                        }
                      >
                        <TableCell className="text-slate-300">{index + 1}</TableCell>
                        <TableCell className="font-medium text-slate-100">
                          <span className="inline-flex items-center gap-2">
                            <NationInsignia
                              color={player.color || palette[index % palette.length]}
                              name={player.name}
                              size="sm"
                              shape="dot"
                            />
                            {formatNation(player.nation)}
                          </span>
                        </TableCell>
                        <TableCell
                          className={player.isActive ? 'text-emerald-300' : 'text-slate-500'}
                        >
                          {player.isActive ? 'Active' : 'Eliminated'}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-slate-100">
                          {player.score}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-300">
                          {player.culture ?? player.history}
                        </TableCell>
                        <TableCell className="text-right text-slate-300">
                          {cityCounts[player.id] ?? '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="mt-2 text-[10px] text-slate-500">
                Your city count is exact; other civilizations show only cities currently present in
                your permitted map snapshot.
              </p>
            </section>
          </div>
        )}
      </HudDialogContent>
    </Dialog>
  );
};
