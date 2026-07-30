import React, { useMemo } from 'react';
import { CheckCircle2, Clock3, Rocket, Satellite, Sparkles } from 'lucide-react';
import type { Player } from '../../types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { NationInsignia } from './NationInsignia';

interface SpaceRaceReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Record<string, Player>;
  currentPlayerId: string;
  currentTurn: number;
}

type PartKey = 'structurals' | 'components' | 'modules';

interface SpaceRaceState {
  structurals: number;
  components: number;
  modules: number;
  launchedTurn?: number;
  arrivalTurn?: number;
}

interface SpaceRaceRow {
  player: Player;
  state: SpaceRaceState;
  progress: number;
  launchProgress: number;
  status: string;
}

const PARTS: Array<{ key: PartKey; label: string; launch: number; limit: number; color: string }> =
  [
    {
      key: 'structurals',
      label: 'Structural',
      launch: 16,
      limit: 32,
      color: 'from-cyan-300 to-blue-500',
    },
    {
      key: 'components',
      label: 'Components',
      launch: 8,
      limit: 16,
      color: 'from-violet-300 to-purple-500',
    },
    {
      key: 'modules',
      label: 'Modules',
      launch: 3,
      limit: 12,
      color: 'from-amber-300 to-orange-500',
    },
  ];

const normalizeState = (value: Record<string, unknown> | undefined): SpaceRaceState => {
  const numberValue = (key: PartKey): number => {
    const candidate = value?.[key];
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.max(0, Math.floor(candidate))
      : 0;
  };
  const turnValue = (key: 'launchedTurn' | 'arrivalTurn'): number | undefined => {
    const candidate = value?.[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
  };
  return {
    structurals: Math.min(numberValue('structurals'), 32),
    components: Math.min(numberValue('components'), 16),
    modules: Math.min(numberValue('modules'), 12),
    launchedTurn: turnValue('launchedTurn'),
    arrivalTurn: turnValue('arrivalTurn'),
  };
};

const getProgress = (state: SpaceRaceState): number =>
  PARTS.reduce((sum, part) => sum + state[part.key] / part.limit, 0) / PARTS.length;

const getLaunchProgress = (state: SpaceRaceState): number =>
  Math.min(...PARTS.map(part => state[part.key] / part.launch));

const getStatus = (state: SpaceRaceState, currentTurn: number): string => {
  if (state.arrivalTurn !== undefined && state.arrivalTurn <= currentTurn) return 'Arrived';
  if (state.launchedTurn !== undefined) return 'In flight';
  if (getLaunchProgress(state) >= 1) return 'Ready to launch';
  if (getProgress(state) > 0) return 'Under construction';
  return 'Not started';
};

const statusClasses: Record<string, string> = {
  Arrived: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200',
  'In flight': 'border-cyan-300/25 bg-cyan-400/10 text-cyan-200',
  'Ready to launch': 'border-amber-300/25 bg-amber-400/10 text-amber-200',
  'Under construction': 'border-violet-300/25 bg-violet-400/10 text-violet-200',
  'Not started': 'border-white/10 bg-white/5 text-slate-500',
};

const percent = (value: number): string => `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;

export const SpaceRaceReport: React.FC<SpaceRaceReportProps> = ({
  open,
  onOpenChange,
  players,
  currentPlayerId,
  currentTurn,
}) => {
  const rows = useMemo<SpaceRaceRow[]>(
    () =>
      Object.values(players)
        .filter(player => player.isActive)
        .map(player => {
          const state = normalizeState(player.spaceshipState);
          return {
            player,
            state,
            progress: getProgress(state),
            launchProgress: getLaunchProgress(state),
            status: getStatus(state, currentTurn),
          };
        })
        .sort((left, right) => right.progress - left.progress),
    [currentTurn, players]
  );

  const currentRow = rows.find(row => row.player.id === currentPlayerId);
  const launchReady = currentRow ? currentRow.launchProgress >= 1 : false;
  const inFlight = currentRow?.state.launchedTurn !== undefined;
  const arrivalTurn = currentRow?.state.arrivalTurn;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto border-white/15 bg-slate-900 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Rocket className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Space race
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Track public spaceship construction, launch readiness, and arrival turns across active
            nations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-4" aria-label="Space race summary">
            <SummaryCard
              icon={Satellite}
              label="Your progress"
              value={percent(currentRow?.progress ?? 0)}
              detail="Maximum part capacity"
            />
            <SummaryCard
              icon={CheckCircle2}
              label="Launch readiness"
              value={launchReady ? 'Ready' : percent(currentRow?.launchProgress ?? 0)}
              detail="Minimum parts required"
            />
            <SummaryCard
              icon={Rocket}
              label="Flight status"
              value={inFlight ? 'In flight' : (currentRow?.status ?? 'No data')}
              detail={
                arrivalTurn !== undefined ? `Arrival turn ${arrivalTurn}` : 'No launch recorded'
              }
            />
            <SummaryCard
              icon={Clock3}
              label="Race contenders"
              value={`${rows.length}`}
              detail="Active nations"
            />
          </section>

          <section
            className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4"
            aria-label="Space race telemetry status"
          >
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-amber-100">
                  Construction telemetry is partial
                </h3>
                <p className="mt-1 text-xs leading-5 text-amber-100/70">
                  Part totals and launch/arrival turns are authoritative. Current production
                  commitments, travel configuration, and launch failure state are not included in
                  the player snapshot yet.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="your-spacecraft-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 id="your-spacecraft-heading" className="text-sm font-semibold text-slate-100">
                Your spacecraft
              </h3>
              <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Launch minimum / capacity
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {PARTS.map(part => {
                const count = currentRow?.state[part.key] ?? 0;
                return (
                  <div key={part.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-200">{part.label}</span>
                      <span className="text-xs tabular-nums text-slate-400">
                        {count} / {part.limit}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${part.color}`}
                        style={{ width: percent(count / part.limit) }}
                      />
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500">
                      Launch minimum: {part.launch}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="space-race-standings-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3
                id="space-race-standings-heading"
                className="text-sm font-semibold text-slate-100"
              >
                Race standings
              </h3>
              <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Part capacity progress
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[700px] border-collapse text-xs">
                <thead className="bg-white/5 text-left text-[10px] uppercase tracking-[0.1em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">Nation</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Progress</th>
                    <th className="px-3 py-2.5 text-right">Structural</th>
                    <th className="px-3 py-2.5 text-right">Components</th>
                    <th className="px-3 py-2.5 text-right">Modules</th>
                    <th className="px-3 py-2.5 text-right">Arrival</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.player.id} className="border-t border-white/10 text-slate-300">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <NationInsignia
                            color={row.player.color}
                            name={row.player.name}
                            size="sm"
                            shape="dot"
                          />
                          <span className="font-semibold text-slate-100">
                            {row.player.nation}
                            {row.player.id === currentPlayerId ? ' (You)' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded border px-1.5 py-0.5 ${statusClasses[row.status]}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="min-w-40 px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-400"
                              style={{ width: percent(row.progress) }}
                            />
                          </div>
                          <span className="w-9 text-right tabular-nums text-slate-400">
                            {percent(row.progress)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.state.structurals}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.state.components}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.state.modules}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.state.arrivalTurn ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SummaryCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
}> = ({ icon: Icon, label, value, detail }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
      <Icon className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
      {label}
    </div>
    <div className="mt-2 text-xl font-semibold tabular-nums text-slate-100">{value}</div>
    <div className="mt-1 text-[10px] text-slate-500">{detail}</div>
  </div>
);
