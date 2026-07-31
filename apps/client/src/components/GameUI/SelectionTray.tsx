import React from 'react';
import {
  ArrowRight,
  Building2,
  ChevronRight,
  Coins,
  CircleDot,
  Crosshair,
  Ellipsis,
  Flag,
  Hammer,
  MapPin,
  ListOrdered,
  Shield,
  Sparkles,
  Swords,
  Users,
  Wheat,
  X,
  Zap,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { gameClient } from '../../services/GameClient';
import { ActionType } from '../../types/shared/actions';
import type { City, Unit } from '../../types';
import { HudIconButton } from './HudIconButton';
import { HudPanel } from './HudPanel';
import { HudTooltip } from './HudTooltip';

const formatName = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const formatNationName = (value: string): string =>
  value
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const ActionButton: React.FC<{
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  showLabel?: boolean;
  tooltip?: string;
}> = ({ label, icon: Icon, onClick, disabled = false, title, showLabel = true, tooltip }) => {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip ? undefined : (title ?? label)}
      aria-label={label}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className={showLabel ? 'hidden sm:inline' : 'sr-only'}>{label}</span>
    </button>
  );

  return tooltip ? <HudTooltip label={tooltip}>{button}</HudTooltip> : button;
};

const Stat: React.FC<{ label: string; value: React.ReactNode; icon: React.ElementType }> = ({
  label,
  value,
  icon: Icon,
}) => (
  <div className="flex items-center gap-1.5 whitespace-nowrap" title={label}>
    <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
    <span className="text-slate-400">{label}</span>
    <span className="font-semibold tabular-nums text-slate-100">{value}</span>
  </div>
);

const TrayDivider = () => <div className="h-8 w-px shrink-0 bg-white/10" aria-hidden="true" />;

const getUnitOrders = (orders: unknown): Array<{ type?: unknown }> =>
  Array.isArray(orders)
    ? orders.filter(
        (order): order is { type?: unknown } => typeof order === 'object' && order !== null
      )
    : [];

const UnitTray: React.FC<{ unit: Unit; unitCount: number }> = ({ unit, unitCount }) => {
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const players = useGameStore(state => state.players);
  const clientState = useGameStore(state => state.clientState);
  const phase = useGameStore(state => state.phase);
  const addNotification = useGameStore(state => state.addNotification);
  const isOwned = unit.playerId === currentPlayerId;
  const canAct = isOwned && clientState === 'running' && phase === 'movement';
  const unitLabel = formatName(unit.unitTypeId);
  const owner = players[unit.playerId];
  const civilizationLabel = owner?.nation ? formatNationName(owner.nation) : unit.playerId;
  const cargoSummary = unit.transportedBy
    ? 'Transported'
    : unit.cargoUnits && unit.cargoUnits.length > 0
      ? `${unit.cargoUnits.length} cargo`
      : unit.transportCapacity && unit.transportCapacity > 0
        ? 'No cargo'
        : undefined;
  const queuedOrders = getUnitOrders(unit.orders);
  const dispatchTargetAction = (action: ActionType) => {
    document.dispatchEvent(
      new CustomEvent(
        action === ActionType.GOTO ? 'activate-goto-mode' : 'activate-target-action-mode',
        {
          detail: { unit, ...(action === ActionType.PATROL ? { action } : {}) },
        }
      )
    );
  };

  const executeAction = async (action: ActionType) => {
    if (!canAct) return;
    if (action === ActionType.GOTO || action === ActionType.PATROL) {
      dispatchTargetAction(action);
      return;
    }

    const success = await gameClient.requestUnitAction(unit.id, action);
    addNotification({
      tone: success ? 'success' : 'error',
      message: success
        ? `${unitLabel}: ${formatName(action)} issued`
        : `${unitLabel}: action failed`,
    });
  };

  const openActions = () => {
    document.dispatchEvent(
      new CustomEvent('show-action-dialog', {
        detail: { unit },
      })
    );
  };

  return (
    <HudPanel
      variant="active"
      className="flex max-w-[min(48rem,calc(100vw-1.5rem))] items-center gap-3 overflow-x-auto px-3 py-2 sm:gap-4 sm:px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
          <Swords className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="max-w-28 truncate text-sm font-semibold text-white">{unitLabel}</span>
            {unitCount > 1 && <span className="text-[10px] text-slate-400">+{unitCount - 1}</span>}
          </div>
          <div
            className="max-w-44 truncate text-[10px] text-slate-500"
            title={
              cargoSummary ? `${civilizationLabel} · Cargo: ${cargoSummary}` : civilizationLabel
            }
          >
            {civilizationLabel}
            {cargoSummary ? ` · Cargo: ${cargoSummary}` : ''}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <TrayDivider />
        {unit.maxFuel ? (
          <div className="hidden items-center gap-3 md:flex">
            <Stat label="Fuel" value={`${unit.fuel ?? 0}/${unit.maxFuel}`} icon={Zap} />
          </div>
        ) : null}
      </div>

      {queuedOrders.length > 0 && (
        <div
          className="hidden items-center gap-1.5 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-cyan-100 lg:flex"
          title="Queued orders"
        >
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{queuedOrders.length} queued</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {queuedOrders.length > 0 && (
          <ActionButton
            label="Cancel orders"
            icon={X}
            onClick={() => void executeAction(ActionType.CANCEL_ORDERS)}
            disabled={!canAct}
            title={canAct ? 'Cancel all queued orders' : 'Unit cannot act right now'}
            showLabel={false}
            tooltip="Cancel orders"
          />
        )}
        <ActionButton
          label="Go to"
          icon={MapPin}
          onClick={() => void executeAction(ActionType.GOTO)}
          disabled={!canAct}
          title={canAct ? 'Select a destination on the map' : 'Unit cannot act right now'}
          showLabel={false}
          tooltip="Go to"
        />
        <ActionButton
          label={unit.fortified ? 'Sentry' : 'Fortify'}
          icon={unit.fortified ? CircleDot : Shield}
          onClick={() =>
            void executeAction(unit.fortified ? ActionType.SENTRY : ActionType.FORTIFY)
          }
          disabled={!canAct || !unit.capabilities?.canFortify}
          title={
            !unit.capabilities?.canFortify
              ? 'This unit cannot fortify'
              : canAct
                ? undefined
                : 'Unit cannot act right now'
          }
          showLabel={false}
          tooltip={unit.fortified ? 'Sentry' : 'Fortify'}
        />
        <ActionButton
          label="More unit actions"
          icon={Ellipsis}
          onClick={openActions}
          showLabel={false}
          tooltip="More unit actions"
        />
      </div>
    </HudPanel>
  );
};

const CityTray: React.FC<{ city: City }> = ({ city }) => {
  const selectCity = useGameStore(state => state.selectCity);
  const selectUnit = useGameStore(state => state.selectUnit);

  const openCityDetails = () => {
    document.dispatchEvent(new CustomEvent('show-city-info', { detail: { city } }));
  };

  return (
    <HudPanel
      variant="active"
      className="flex max-w-[min(52rem,calc(100vw-1.5rem))] items-center gap-3 overflow-x-auto px-3 py-2 sm:gap-4 sm:px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-300/30 bg-violet-300/10 text-violet-200">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="max-w-36 truncate text-sm font-semibold text-white">{city.name}</span>
            {city.isCapital && <Flag className="h-3.5 w-3.5 text-amber-300" aria-label="Capital" />}
          </div>
          <div
            className="text-[10px] uppercase tracking-[0.12em] text-slate-400"
            title={
              city.actualPopulation === undefined
                ? 'Population uses city-size fallback'
                : 'Population'
            }
          >
            Pop {city.actualPopulation ?? city.size} ·{' '}
            {city.granaryTurns < 0
              ? 'Starving'
              : city.granaryTurns === 0
                ? 'Stable'
                : `Growth in ${city.granaryTurns}`}
          </div>
        </div>
      </div>

      <TrayDivider />

      <div className="hidden items-center gap-3 md:flex">
        <Stat label="Food" value={city.surplus.food} icon={Wheat} />
        <Stat label="Build" value={city.surplus.shields} icon={Hammer} />
        <Stat label="Gold" value={city.surplus.gold} icon={CoinsIcon} />
        <Stat label="Science" value={city.surplus.science} icon={Sparkles} />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <div className="hidden items-center gap-1.5 text-xs text-slate-300 lg:flex">
          <span className="text-slate-500">Building</span>
          <span className="max-w-28 truncate font-medium">
            {city.production?.target ?? 'Nothing'}
          </span>
          {city.production && (
            <span className="text-slate-400">· {city.production.turnsToComplete}t</span>
          )}
        </div>
        <ActionButton label="Open city" icon={Building2} onClick={openCityDetails} />
        <HudIconButton
          label="Clear city selection"
          onClick={() => {
            selectCity(null);
            selectUnit(null);
          }}
        >
          <ChevronRight className="h-4 w-4 rotate-90" aria-hidden="true" />
        </HudIconButton>
      </div>
    </HudPanel>
  );
};

const CoinsIcon = Coins;

export const SelectionTray: React.FC = () => {
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const selectedCityId = useGameStore(state => state.selectedCityId);
  const focusedUnits = useGameStore(state => state.focusedUnits);
  const units = useGameStore(state => state.units);
  const cities = useGameStore(state => state.cities);
  const urgentFocusQueue = useGameStore(state => state.urgentFocusQueue);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const advanceUnitFocus = useGameStore(state => state.advanceUnitFocus);

  const selectedUnit = selectedUnitId
    ? units[selectedUnitId]
    : focusedUnits[0]
      ? units[focusedUnits[0]]
      : null;
  const selectedCity = selectedCityId ? cities[selectedCityId] : null;

  if (selectedUnit) {
    return <UnitTray unit={selectedUnit} unitCount={focusedUnits.length} />;
  }

  if (selectedCity) {
    return <CityTray city={selectedCity} />;
  }

  const pendingUnits = Object.values(units).filter(
    unit => unit.playerId === currentPlayerId && unit.movesLeft > 0 && !unit.doneMoving
  ).length;

  return (
    <HudPanel className="flex max-w-[min(34rem,calc(100vw-1.5rem))] items-center gap-3 overflow-x-auto px-3 py-2 sm:px-4">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <Crosshair className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <span className="hidden sm:inline">Select a unit or city</span>
        <span className="sm:hidden">Select an object</span>
      </div>
      <TrayDivider />
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] text-slate-400">
        <span>{pendingUnits} pending</span>
        {urgentFocusQueue.length > 0 && (
          <span className="text-amber-300">{urgentFocusQueue.length} urgent</span>
        )}
      </div>
      {pendingUnits > 0 && (
        <ActionButton
          label="Focus next unit"
          icon={ArrowRight}
          onClick={() => advanceUnitFocus()}
        />
      )}
      <Users className="hidden h-4 w-4 text-slate-500 sm:block" aria-hidden="true" />
    </HudPanel>
  );
};
