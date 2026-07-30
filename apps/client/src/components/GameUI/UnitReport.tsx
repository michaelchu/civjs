import React from 'react';
import { Coins, Crosshair, Heart, Home, Shield, Swords, Wheat } from 'lucide-react';
import type { City, Unit } from '../../types';
import { useGameStore } from '../../store/gameStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';

interface UnitReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: Record<string, Unit>;
  cities: Record<string, City>;
  currentPlayerId: string;
}

const formatName = (value: string): string =>
  value
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const statusFor = (unit: Unit): { label: string; tone: string } => {
  if (unit.movesLeft > 0 && !unit.doneMoving) return { label: 'Ready', tone: 'text-emerald-300' };
  if (unit.fortified) return { label: 'Fortified', tone: 'text-cyan-300' };
  return { label: 'Done', tone: 'text-slate-500' };
};

export const UnitReport: React.FC<UnitReportProps> = ({
  open,
  onOpenChange,
  units,
  cities,
  currentPlayerId,
}) => {
  const selectUnit = useGameStore(state => state.selectUnit);
  const selectCity = useGameStore(state => state.selectCity);
  const ownUnits = Object.values(units).filter(unit => unit.playerId === currentPlayerId);
  const totalUpkeep = ownUnits.reduce(
    (totals, unit) => ({
      food: totals.food + (unit.upkeep?.food ?? 0),
      shields: totals.shields + (unit.upkeep?.shields ?? 0),
      gold: totals.gold + (unit.upkeep?.gold ?? 0),
    }),
    { food: 0, shields: 0, gold: 0 }
  );
  const readyCount = ownUnits.filter(unit => unit.movesLeft > 0 && !unit.doneMoving).length;
  const veteranCount = ownUnits.filter(unit => unit.veteranLevel > 0).length;

  const focusUnit = (unit: Unit) => {
    selectCity(null);
    selectUnit(unit.id);
    document.dispatchEvent(new CustomEvent('center-map-on-tile', { detail: { x: unit.x, y: unit.y } }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto border-white/15 bg-slate-900 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Swords className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Units and upkeep
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Your unit roster, readiness, support costs, and map locations. Foreign units are not included.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-5" aria-label="Unit summary">
            <SummaryCard icon={Swords} label="Total units" value={`${ownUnits.length}`} />
            <SummaryCard icon={Crosshair} label="Ready" value={`${readyCount}`} tone="text-emerald-300" />
            <SummaryCard icon={Shield} label="Veterans" value={`${veteranCount}`} tone="text-violet-300" />
            <SummaryCard icon={Wheat} label="Food upkeep" value={`${totalUpkeep.food}`} tone="text-amber-300" />
            <SummaryCard icon={Coins} label="Gold upkeep" value={`${totalUpkeep.gold}`} tone="text-amber-300" />
          </section>

          {ownUnits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-6 text-sm text-slate-400">No units are currently available.</div>
          ) : (
            <section aria-labelledby="unit-roster-heading">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 id="unit-roster-heading" className="text-sm font-semibold text-slate-100">Unit roster</h3>
                <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Click a row to center map</span>
              </div>
              <Table className="border-white/10">
                <TableHeader className="bg-slate-800">
                  <TableRow className="border-white/10 hover:bg-slate-800">
                    <TableHead className="text-slate-300">Unit</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                    <TableHead className="text-right text-slate-300">Health</TableHead>
                    <TableHead className="text-right text-slate-300">Move</TableHead>
                    <TableHead className="text-slate-300">Home city</TableHead>
                    <TableHead className="text-right text-slate-300">Upkeep</TableHead>
                    <TableHead className="text-right text-slate-300">Location</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ownUnits.map(unit => {
                    const status = statusFor(unit);
                    const homeCity = unit.homeCityId ? cities[unit.homeCityId]?.name : undefined;
                    return (
                      <TableRow key={unit.id} className="border-white/10">
                        <TableCell className="font-medium text-slate-100">
                          <button
                            type="button"
                            onClick={() => focusUnit(unit)}
                            aria-label={`Focus ${formatName(unit.unitTypeId)}`}
                            className="flex items-center gap-2 rounded px-1 py-1 text-left hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                          >
                            <Swords className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                            {formatName(unit.unitTypeId)}
                          </button>
                        </TableCell>
                        <TableCell className={status.tone}>{status.label}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-300"><span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />{unit.hp}%</span></TableCell>
                        <TableCell className="text-right tabular-nums text-slate-300">{unit.movesLeft}/{unit.maxMoves ?? '—'}</TableCell>
                        <TableCell className="text-slate-400"><span className="inline-flex items-center gap-1"><Home className="h-3.5 w-3.5" aria-hidden="true" />{homeCity ?? 'Unassigned'}</span></TableCell>
                        <TableCell className="text-right text-[10px] tabular-nums text-slate-400">{formatUpkeep(unit)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-400"><span className="inline-flex items-center gap-1"><Crosshair className="h-3.5 w-3.5" aria-hidden="true" />{unit.x}, {unit.y}</span></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          )}

          <p className="text-[10px] text-slate-500">{totalUpkeep.shields} shield upkeep is included in the aggregate but may be resolved through city support rules.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const formatUpkeep = (unit: Unit): string => {
  const upkeep = unit.upkeep;
  if (!upkeep || (upkeep.food === 0 && upkeep.shields === 0 && upkeep.gold === 0)) return '—';
  return [
    upkeep.food ? `${upkeep.food}F` : '',
    upkeep.shields ? `${upkeep.shields}S` : '',
    upkeep.gold ? `${upkeep.gold}G` : '',
  ].filter(Boolean).join(' · ');
};

const SummaryCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: string;
}> = ({ icon: Icon, label, value, tone = 'text-cyan-300' }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
      <Icon className={`h-3.5 w-3.5 ${tone}`} aria-hidden="true" />
      {label}
    </div>
    <div className="mt-2 text-xl font-semibold tabular-nums text-slate-100">{value}</div>
  </div>
);
