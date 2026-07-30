import React from 'react';
import {
  AlertTriangle,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FlaskConical,
  LocateFixed,
  ScrollText,
  Sparkles,
  Swords,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import type { City, Unit } from '../../types';
import { HudIconButton } from './HudIconButton';
import { HudPanel } from './HudPanel';

const formatName = (value: string): string =>
  value
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const centerOn = (x: number, y: number) => {
  document.dispatchEvent(new CustomEvent('center-map-on-tile', { detail: { x, y } }));
};

const SectionHeading: React.FC<{
  icon: React.ElementType;
  label: string;
  count?: number;
  urgent?: boolean;
}> = ({ icon: Icon, label, count, urgent = false }) => (
  <div className="flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
    <Icon className={`h-3.5 w-3.5 ${urgent ? 'text-amber-300' : 'text-cyan-300'}`} aria-hidden="true" />
    <span>{label}</span>
    {count !== undefined && (
      <span className={`ml-auto tabular-nums ${urgent ? 'text-amber-300' : 'text-slate-500'}`}>
        {count}
      </span>
    )}
  </div>
);

const LinkRow: React.FC<{
  icon: React.ElementType;
  title: string;
  detail: string;
  tone?: 'default' | 'urgent' | 'success';
  onClick: () => void;
  ariaLabel?: string;
}> = ({ icon: Icon, title, detail, tone = 'default', onClick, ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel ?? title}
    className="group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
  >
    <Icon
      className={`mt-0.5 h-4 w-4 shrink-0 ${
        tone === 'urgent' ? 'text-amber-300' : tone === 'success' ? 'text-emerald-300' : 'text-slate-400'
      }`}
      aria-hidden="true"
    />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-xs font-medium text-slate-100 group-hover:text-white">
        {title}
      </span>
      <span className="mt-0.5 block truncate text-[10px] text-slate-400">{detail}</span>
    </span>
    <LocateFixed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600 group-hover:text-cyan-300" aria-hidden="true" />
  </button>
);

const ResearchObjective: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const research = useGameStore(state => state.research);
  const technologies = useGameStore(state => state.technologies);
  const techId = research?.techGoal ?? research?.currentTech;
  const technology = techId ? technologies[techId] : undefined;

  if (!techId) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span>
          <span className="block text-xs font-medium text-slate-200">Choose a research goal</span>
          <span className="mt-0.5 block text-[10px] text-slate-500">Open the technology tree</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open research goal ${technology?.name ?? formatName(techId)}`}
      className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-slate-100">
          {technology?.name ?? formatName(techId)}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-slate-400">
          {research?.currentTech === techId ? `${research.bulbsAccumulated} bulbs invested` : 'Goal'}
          {technology ? ` · ${technology.cost} cost` : ''}
        </span>
      </span>
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300/70" aria-hidden="true" />
    </button>
  );
};

const CityAlertRow: React.FC<{ city: City }> = ({ city }) => {
  const selectCity = useGameStore(state => state.selectCity);
  const selectUnit = useGameStore(state => state.selectUnit);
  const reasons = [
    city.disorder ? 'Disorder' : null,
    city.granaryTurns < 0 ? 'Starvation' : null,
    !city.production ? 'No production' : null,
  ].filter(Boolean) as string[];

  return (
    <LinkRow
      icon={AlertTriangle}
      title={city.name}
      detail={reasons.join(' · ')}
      tone="urgent"
      ariaLabel={`Center on ${city.name}: ${reasons.join(', ')}`}
      onClick={() => {
        selectUnit(null);
        selectCity(city.id);
        centerOn(city.x, city.y);
      }}
    />
  );
};

const UnitOrderRow: React.FC<{ unit: Unit }> = ({ unit }) => {
  const selectUnit = useGameStore(state => state.selectUnit);
  const selectCity = useGameStore(state => state.selectCity);

  return (
    <LinkRow
      icon={Swords}
      title={formatName(unit.unitTypeId)}
      detail={`${unit.movesLeft} movement${unit.movesLeft === 1 ? '' : 's'} remaining`}
      tone="urgent"
      ariaLabel={`Select ${formatName(unit.unitTypeId)} awaiting orders`}
      onClick={() => {
        selectCity(null);
        selectUnit(unit.id);
        centerOn(unit.x, unit.y);
      }}
    />
  );
};

export const ObjectivesJournal: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const setActiveTab = useGameStore(state => state.setActiveTab);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const notifications = useGameStore(state => state.notifications);
  const urgentFocusQueue = useGameStore(state => state.urgentFocusQueue);

  const ownedCities = React.useMemo(
    () => Object.values(cities).filter(city => city.playerId === currentPlayerId),
    [cities, currentPlayerId]
  );
  const cityAlerts = React.useMemo(
    () =>
      ownedCities.filter(city => city.disorder || city.granaryTurns < 0 || !city.production),
    [ownedCities]
  );
  const pendingUnits = React.useMemo(
    () =>
      Object.values(units).filter(
        unit => unit.playerId === currentPlayerId && unit.movesLeft > 0 && !unit.doneMoving
      ),
    [units, currentPlayerId]
  );
  const recentEvents = notifications.slice(-3).reverse();
  const urgentCount = cityAlerts.length + pendingUnits.length + urgentFocusQueue.length;

  if (collapsed) {
    return (
      <HudPanel className="flex w-11 flex-col items-center gap-2 p-1.5">
        <HudIconButton label="Expand objectives and journal" onClick={() => setCollapsed(false)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
        {urgentCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400/20 px-1 text-[10px] font-semibold tabular-nums text-amber-200">
            {urgentCount}
          </span>
        )}
      </HudPanel>
    );
  }

  return (
    <>
      <HudPanel className="flex w-11 flex-col items-center gap-2 p-1.5 sm:hidden">
        <HudIconButton label="Open objectives and journal" onClick={() => setMobileOpen(true)}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
        {urgentCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400/20 px-1 text-[10px] font-semibold tabular-nums text-amber-200">
            {urgentCount}
          </span>
        )}
      </HudPanel>
      <HudPanel
        className={`${mobileOpen ? 'flex' : 'hidden'} max-h-[min(36rem,calc(100vh-8rem))] w-72 flex-col overflow-hidden sm:flex`}
      >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-100">Objectives</div>
          <div className="text-[10px] text-slate-500">Journal and empire attention</div>
        </div>
        {urgentCount > 0 && (
          <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-200">
            {urgentCount}
          </span>
        )}
        <HudIconButton
          label="Collapse objectives and journal"
          onClick={() => {
            setCollapsed(true);
            setMobileOpen(false);
          }}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
      </div>

      <div className="space-y-3 overflow-y-auto p-2">
        <section>
          <SectionHeading icon={FlaskConical} label="Research" />
          <ResearchObjective onOpen={() => setActiveTab('research')} />
        </section>

        <section>
          <SectionHeading icon={CircleAlert} label="City attention" count={cityAlerts.length} urgent={cityAlerts.length > 0} />
          {cityAlerts.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {cityAlerts.slice(0, 4).map(city => <CityAlertRow key={city.id} city={city} />)}
              {cityAlerts.length > 4 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('cities')}
                  className="w-full px-2 py-1 text-left text-[10px] text-cyan-300 hover:text-cyan-200"
                >
                  View {cityAlerts.length - 4} more cities
                </button>
              )}
            </div>
          ) : (
            <div className="px-2 py-2 text-[10px] text-emerald-300/80">All cities stable</div>
          )}
        </section>

        <section>
          <SectionHeading icon={Swords} label="Awaiting orders" count={pendingUnits.length} urgent={pendingUnits.length > 0} />
          {pendingUnits.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {pendingUnits.slice(0, 4).map(unit => <UnitOrderRow key={unit.id} unit={unit} />)}
              {pendingUnits.length > 4 && (
                <div className="px-2 py-1 text-[10px] text-slate-500">{pendingUnits.length - 4} more units pending</div>
              )}
            </div>
          ) : (
            <div className="px-2 py-2 text-[10px] text-slate-500">No units need attention</div>
          )}
        </section>

        <section>
          <SectionHeading icon={ScrollText} label="Recent events" count={recentEvents.length} />
          {recentEvents.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {recentEvents.map(event => (
                <div key={event.id} className="flex items-start gap-2 rounded-lg px-2 py-2">
                  <ScrollText
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      event.tone === 'error' ? 'text-rose-300' : event.tone === 'success' ? 'text-emerald-300' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="line-clamp-2 text-[10px] leading-4 text-slate-300">{event.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-2 py-2 text-[10px] text-slate-500">No major events yet</div>
          )}
        </section>

        <div className="flex items-center gap-1.5 border-t border-white/10 px-2 pt-2 text-[10px] text-slate-500">
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{ownedCities.length} cities tracked</span>
        </div>
      </div>
      </HudPanel>
    </>
  );
};
