import React from 'react';
import {
  Building2,
  CalendarDays,
  Coins,
  FlaskConical,
  Gauge,
  ArrowLeftRight,
  Palette,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { openReport } from './reportEvents';
import type { City, Player } from '../../types';
import { NationInsignia } from './NationInsignia';

const formatNationName = (nation: string): string => {
  if (nation === 'random') return 'Random';

  return nation
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const formatYear = (year: number | undefined): string => {
  if (year === undefined) return '—';
  return year < 0 ? `${Math.abs(year)} BC` : `${year} AD`;
};

const ResourceDelta: React.FC<{ label: string; value?: number }> = ({ label, value = 0 }) => (
  <span
    aria-label={`${label} per turn`}
    className={value > 0 ? 'text-emerald-300' : value < 0 ? 'text-rose-300' : 'text-slate-400'}
  >
    ({value >= 0 ? '+' : ''}
    {value})
  </span>
);

interface ResourceMetricProps {
  label: string;
  value: number;
  delta?: number;
  icon: React.ElementType;
  tone: string;
}

const ResourceMetric: React.FC<ResourceMetricProps> = ({
  label,
  value,
  delta,
  icon: Icon,
  tone,
}) => (
  <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={`${label}: ${value}`}>
    <Icon className={`h-3.5 w-3.5 ${tone}`} aria-hidden="true" />
    <span className="hidden text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 xl:inline">
      {label}
    </span>
    <span className="font-semibold tabular-nums text-slate-100">{value}</span>
    {delta !== undefined && <ResourceDelta label={label} value={delta} />}
  </div>
);

const StatusPill: React.FC<{
  clientState: string;
  phase: string;
  pendingActions: number;
  processing: boolean;
}> = ({ clientState, phase, pendingActions, processing }) => {
  const isRunning = clientState === 'running';
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-2 text-[9px] font-medium uppercase tracking-[0.1em] text-slate-400 sm:pl-3 sm:text-[10px]"
      title={`${clientState} · ${phase} phase${pendingActions > 0 ? ` · ${pendingActions} pending actions` : ''}`}
    >
      <Wifi className={isRunning ? 'h-3.5 w-3.5 text-emerald-300' : 'h-3.5 w-3.5 text-amber-300'} />
      <span>{isRunning ? 'Online' : clientState.replaceAll('_', ' ')}</span>
      <span className="text-slate-500">·</span>
      <span>{phase}</span>
      {processing ? (
        <>
          <span className="text-slate-500">·</span>
          <span className="text-cyan-300">Processing</span>
        </>
      ) : pendingActions > 0 ? (
        <>
          <span className="text-slate-500">·</span>
          <span className="text-amber-200">{pendingActions} pending</span>
        </>
      ) : null}
    </div>
  );
};

const EconomyButton: React.FC<{ player: Player; onOpen: () => void }> = ({ player, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
    aria-label="Open economy settings"
    title="Open economy settings"
  >
    <Gauge className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
    <span className="hidden text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 xl:inline">
      Rates
    </span>
    <span className="font-semibold tabular-nums text-slate-100">
      {player.taxRate ?? '—'}/{player.luxuryRate ?? '—'}/{player.scienceRate ?? '—'}%
    </span>
  </button>
);

export const StatusPanel: React.FC<{ onOpenDemographics?: () => void }> = ({
  onOpenDemographics,
}) => {
  const turn = useGameStore(state => state.turn);
  const year = useGameStore(state => state.year);
  const phase = useGameStore(state => state.phase);
  const clientState = useGameStore(state => state.clientState);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const urgentFocusQueue = useGameStore(state => state.urgentFocusQueue);
  const turnProcessingState = useGameStore(state => state.turnProcessingState);
  const currentPlayer = useGameStore(state => state.players[currentPlayerId]);
  const cities = useGameStore(state => state.cities);
  const setActiveTab = useGameStore(state => state.setActiveTab);

  if (!currentPlayer) {
    return <div className="px-2 text-sm text-slate-400">Loading civilization status…</div>;
  }

  const ownedCities = Object.values(cities).filter(
    (city: City) => city.playerId === currentPlayerId
  );
  const population = ownedCities.reduce(
    (total, city) => total + (city.actualPopulation ?? city.size),
    0
  );
  const trade = ownedCities.reduce((total, city) => total + (city.trade ?? 0), 0);

  return (
    <div className="flex min-w-max items-center gap-2 text-xs sm:gap-3">
      <button
        type="button"
        onClick={() => openReport('government')}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
        aria-label={`Open ${formatNationName(currentPlayer.nation)} government`}
        title={`${formatNationName(currentPlayer.nation)} · ${currentPlayer.name}`}
      >
        <NationInsignia color={currentPlayer.color} name={formatNationName(currentPlayer.nation)} />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-28 truncate font-semibold text-slate-100">
            {formatNationName(currentPlayer.nation)}
          </span>
          <span className="block max-w-28 truncate text-[10px] text-slate-400">
            {currentPlayer.name}
          </span>
        </span>
      </button>

      <div className="hidden h-7 w-px bg-white/10 sm:block" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <ResourceMetric
          label="Gold"
          value={currentPlayer.gold}
          delta={currentPlayer.goldPerTurn}
          icon={Coins}
          tone="text-amber-300"
        />
        <ResourceMetric
          label="Science"
          value={currentPlayer.science}
          delta={currentPlayer.sciencePerTurn}
          icon={FlaskConical}
          tone="text-sky-300"
        />
        <ResourceMetric
          label="Culture"
          value={currentPlayer.culture ?? currentPlayer.history}
          icon={Palette}
          tone="text-violet-300"
        />
        <div
          className="hidden items-center gap-1.5 whitespace-nowrap md:flex"
          title={`Trade: ${trade}`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 text-teal-300" aria-hidden="true" />
          <span className="hidden text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 xl:inline">
            Trade
          </span>
          <span className="font-semibold tabular-nums text-slate-100">{trade}</span>
        </div>
        <div className="hidden items-center gap-1.5 whitespace-nowrap md:flex" title="Luxury rate">
          <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
          <span className="font-semibold tabular-nums text-slate-100">
            {currentPlayer.luxuryRate ?? '—'}%
          </span>
        </div>
        <EconomyButton player={currentPlayer} onOpen={() => setActiveTab('options')} />
      </div>

      <div className="hidden h-7 w-px bg-white/10 lg:block" aria-hidden="true" />

      <div
        className="flex items-center gap-1.5 whitespace-nowrap"
        title={`Population: ${population} · ${ownedCities.length} cities`}
      >
        <Users className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" />
        <span className="font-semibold tabular-nums text-slate-100">{population}</span>
        <span className="hidden text-slate-500 sm:inline">·</span>
        <span className="hidden text-slate-400 sm:inline">{ownedCities.length} cities</span>
      </div>

      <div className="hidden items-center gap-3 lg:flex">
        <div className="flex items-center gap-1.5 whitespace-nowrap" title="Current score">
          <Building2 className="h-3.5 w-3.5 text-teal-300" aria-hidden="true" />
          <span className="font-semibold tabular-nums text-slate-100">
            {currentPlayer.score ?? '—'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => openReport('government')}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
          aria-label={`Open ${currentPlayer.government} government`}
          title="Open government"
        >
          <span>{formatNationName(currentPlayer.government)}</span>
        </button>
      </div>

      <div className="flex items-center gap-2 border-l border-white/10 pl-3">
        <button
          type="button"
          onClick={() => {
            if (onOpenDemographics) onOpenDemographics();
            else openReport('diplomacy');
          }}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
          aria-label="Open demographics report"
          title="Open demographics report"
        >
          <CalendarDays className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
          <span className="font-semibold tabular-nums text-slate-100">{turn}</span>
          <span className="hidden text-slate-400 sm:inline">· {formatYear(year)}</span>
        </button>
        <StatusPill
          clientState={clientState}
          phase={phase}
          pendingActions={urgentFocusQueue?.length ?? 0}
          processing={turnProcessingState === 'processing'}
        />
      </div>
    </div>
  );
};
