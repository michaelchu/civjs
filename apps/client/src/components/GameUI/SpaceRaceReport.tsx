/**
 * @module client/components/GameUI/SpaceRaceReport
 * Defines the Space Race Report client UI component.
 */
import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Rocket, Satellite, Sparkles } from 'lucide-react';
import type { Player } from '../../types';
import { gameClient } from '../../services/GameClient';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { NationInsignia } from './NationInsignia';
import { HudDialogContent } from './HudDialogContent';

interface SpaceRaceReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Record<string, Player>;
  currentPlayerId: string;
  currentYear?: number;
}

type PartKey = 'structurals' | 'components' | 'modules';
type SpaceshipStatus = 'none' | 'started' | 'launched' | 'arrived';

interface SpaceRaceState {
  structurals: number;
  components: number;
  modules: number;
  status: SpaceshipStatus;
  placedStructurals: number[];
  fuel: number;
  propulsion: number;
  habitation: number;
  lifeSupport: number;
  solarPanels: number;
  launchYear?: number;
  arrivalYear?: number;
  population?: number;
  successRate: number;
  travelTime?: number;
}

interface SpaceRaceRow {
  player: Player;
  state: SpaceRaceState;
  progress: number;
  status: string;
}

const PARTS: Array<{ key: PartKey; label: string; limit: number; color: string }> = [
  {
    key: 'structurals',
    label: 'Structural',
    limit: 32,
    color: 'from-cyan-300 to-blue-500',
  },
  {
    key: 'components',
    label: 'Components',
    limit: 16,
    color: 'from-violet-300 to-purple-500',
  },
  {
    key: 'modules',
    label: 'Modules',
    limit: 12,
    color: 'from-amber-300 to-orange-500',
  },
];

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const boundedInteger = (value: unknown, limit: number): number => {
  const number = finiteNumber(value);
  return number === undefined ? 0 : Math.max(0, Math.min(limit, Math.floor(number)));
};

const isSpaceshipStatus = (value: unknown): value is SpaceshipStatus =>
  value === 'none' || value === 'started' || value === 'launched' || value === 'arrived';

const normalizeState = (value: Record<string, unknown> | undefined): SpaceRaceState => {
  const structurals = boundedInteger(value?.structurals, 32);
  const components = boundedInteger(value?.components, 16);
  const modules = boundedInteger(value?.modules, 12);
  const launchYear = finiteNumber(value?.launchYear);
  const arrivalYear = finiteNumber(value?.arrivalYear);
  const hasLegacyLaunch =
    finiteNumber(value?.launchedTurn) !== undefined ||
    finiteNumber(value?.arrivalTurn) !== undefined;
  const rawPlacedStructurals = Array.isArray(value?.placedStructurals)
    ? value.placedStructurals.filter(index => Number.isInteger(index) && index >= 0 && index < 32)
    : [];
  const placedStructurals = [...new Set(rawPlacedStructurals)]
    .sort((left, right) => left - right)
    .slice(0, structurals);
  const fuel = boundedInteger(value?.fuel, Math.min(components, 8));
  const propulsion = boundedInteger(value?.propulsion, Math.min(components - fuel, 8));
  const habitation = boundedInteger(value?.habitation, Math.min(modules, 4));
  const lifeSupport = boundedInteger(value?.lifeSupport, Math.min(modules - habitation, 4));
  const solarPanels = boundedInteger(
    value?.solarPanels,
    Math.min(modules - habitation - lifeSupport, 4)
  );
  const hasParts = structurals + components + modules > 0;

  return {
    structurals,
    components,
    modules,
    status: isSpaceshipStatus(value?.status)
      ? value.status
      : launchYear !== undefined || arrivalYear !== undefined || hasLegacyLaunch
        ? 'launched'
        : hasParts
          ? 'started'
          : 'none',
    placedStructurals,
    fuel,
    propulsion,
    habitation,
    lifeSupport,
    solarPanels,
    ...(launchYear === undefined ? {} : { launchYear }),
    ...(arrivalYear === undefined ? {} : { arrivalYear }),
    ...(finiteNumber(value?.population) === undefined
      ? {}
      : { population: Math.max(0, Math.floor(finiteNumber(value?.population)!)) }),
    successRate: Math.max(0, Math.min(100, finiteNumber(value?.successRate) ?? 0)),
    ...(finiteNumber(value?.travelTime) === undefined
      ? {}
      : { travelTime: Math.max(0, finiteNumber(value?.travelTime)!) }),
  };
};

const getProgress = (state: SpaceRaceState): number =>
  PARTS.reduce((sum, part) => sum + state[part.key] / part.limit, 0) / PARTS.length;

const getStatus = (state: SpaceRaceState, currentYear: number | undefined): string => {
  if (
    state.status === 'arrived' ||
    (currentYear !== undefined &&
      state.arrivalYear !== undefined &&
      state.arrivalYear <= currentYear)
  ) {
    return 'Arrived';
  }
  if (state.status === 'launched') return 'In flight';
  if (state.status === 'started' && state.successRate > 0) return 'Ready to launch';
  if (state.status === 'started' || getProgress(state) > 0) return 'Under construction';
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

const arrivalDetail = (state: SpaceRaceState): string =>
  state.arrivalYear === undefined ? 'No launch recorded' : `Arrival year ${state.arrivalYear}`;

const partDetail = (part: PartKey, state: SpaceRaceState): string => {
  if (part === 'structurals') return `${state.placedStructurals.length} attached`;
  if (part === 'components') return `Fuel ${state.fuel} · Propulsion ${state.propulsion}`;
  return `Habitation ${state.habitation} · Life support ${state.lifeSupport} · Solar ${state.solarPanels}`;
};

export const SpaceRaceReport: React.FC<SpaceRaceReportProps> = ({
  open,
  onOpenChange,
  players,
  currentPlayerId,
  currentYear,
}) => {
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string>();
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
            status: getStatus(state, currentYear),
          };
        })
        .sort((left, right) => right.progress - left.progress),
    [currentYear, players]
  );

  const currentRow = rows.find(row => row.player.id === currentPlayerId);
  const launchReady =
    currentRow?.state.status === 'started' && (currentRow.state.successRate ?? 0) > 0;
  const canLaunch = currentRow?.player.isHuman === true && launchReady;

  const requestLaunch = async (): Promise<void> => {
    setLaunching(true);
    setLaunchError(undefined);
    try {
      await gameClient.launchSpaceship();
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Failed to launch spaceship');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <HudDialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Rocket className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Space race
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Track public spaceship construction, launch readiness, and arrival years across active
            nations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-4" aria-label="Space race summary">
            <SummaryCard
              icon={Satellite}
              label="Your progress"
              value={percent(currentRow?.progress ?? 0)}
              detail="Built part capacity"
            />
            <SummaryCard
              icon={CheckCircle2}
              label="Launch readiness"
              value={launchReady ? 'Ready' : 'Not ready'}
              detail={
                launchReady
                  ? `${percent(currentRow?.state.successRate ?? 0)} projected success`
                  : 'Requires a viable assembled ship'
              }
            />
            <SummaryCard
              icon={Rocket}
              label="Flight status"
              value={currentRow?.status ?? 'No data'}
              detail={currentRow ? arrivalDetail(currentRow.state) : 'No launch recorded'}
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
                <h3 className="text-sm font-semibold text-amber-100">Authoritative assembly</h3>
                <p className="mt-1 text-xs leading-5 text-amber-100/70">
                  Built and placed-part state, flight metrics, and arrival years come from the
                  server. Completed parts follow Freeciv&apos;s assembly order; launching remains an
                  explicit player command.
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
                Built / capacity
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
                      {currentRow ? partDetail(part.key, currentRow.state) : 'No parts built'}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {currentRow?.player.isHuman && currentRow.state.status === 'started' && (
            <section
              className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-4"
              aria-labelledby="space-launch-heading"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 id="space-launch-heading" className="text-sm font-semibold text-cyan-100">
                    Launch command
                  </h3>
                  <p className="mt-1 text-xs text-cyan-100/70">
                    {launchReady
                      ? `Projected success: ${percent(currentRow.state.successRate)}.`
                      : 'Attach enough connected modules and propulsion before launch.'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void requestLaunch()}
                  disabled={!canLaunch || launching}
                  className="bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                >
                  {launching ? 'Launching…' : 'Launch spaceship'}
                </Button>
              </div>
              {launchError && (
                <p className="mt-3 text-xs text-rose-200" role="alert">
                  {launchError}
                </p>
              )}
            </section>
          )}

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
                    <th className="px-3 py-2.5 text-right">Arrival year</th>
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
                        {row.state.arrivalYear ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </HudDialogContent>
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
