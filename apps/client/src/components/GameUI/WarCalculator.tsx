import React, { useEffect, useMemo, useState } from 'react';
import { Crosshair, Heart, Shield, Swords, TriangleAlert } from 'lucide-react';
import type { Unit } from '../../types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

interface WarCalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: Record<string, Unit>;
  currentPlayerId: string;
}

const formatName = (value: string): string =>
  value
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const statValue = (value: number | undefined): string =>
  value === undefined ? '—' : `${value}`;

const effectivePower = (unit: Unit, mode: 'attack' | 'defense'): number | null => {
  const base = mode === 'attack' ? unit.attack : unit.defense;
  if (base === undefined || unit.firepower === undefined) return null;
  return base * unit.firepower * Math.max(0, unit.hp) / 100;
};

const outcomeFor = (attacker: number | null, defender: number | null): { label: string; className: string } => {
  if (attacker === null || defender === null) {
    return { label: 'Insufficient data', className: 'text-slate-400' };
  }
  if (attacker === defender) return { label: 'Even estimate', className: 'text-amber-200' };
  if (attacker > defender * 1.2) return { label: 'Attacker advantage', className: 'text-emerald-200' };
  if (defender > attacker * 1.2) return { label: 'Defender advantage', className: 'text-rose-200' };
  return { label: 'Close estimate', className: 'text-amber-200' };
};

export const WarCalculator: React.FC<WarCalculatorProps> = ({
  open,
  onOpenChange,
  units,
  currentPlayerId,
}) => {
  const availableUnits = useMemo(() => Object.values(units).filter(unit => unit.attack !== undefined || unit.defense !== undefined), [units]);
  const ownUnits = availableUnits.filter(unit => unit.playerId === currentPlayerId);
  const opposingUnits = availableUnits.filter(unit => unit.playerId !== currentPlayerId);
  const [attackerId, setAttackerId] = useState(ownUnits[0]?.id ?? availableUnits[0]?.id ?? '');
  const [defenderId, setDefenderId] = useState(opposingUnits[0]?.id ?? availableUnits[1]?.id ?? '');

  useEffect(() => {
    if (!availableUnits.some(unit => unit.id === attackerId)) setAttackerId(ownUnits[0]?.id ?? availableUnits[0]?.id ?? '');
    if (!availableUnits.some(unit => unit.id === defenderId)) setDefenderId(opposingUnits[0]?.id ?? availableUnits[1]?.id ?? '');
  }, [attackerId, availableUnits, defenderId, opposingUnits, ownUnits]);

  const attacker = availableUnits.find(unit => unit.id === attackerId);
  const defender = availableUnits.find(unit => unit.id === defenderId);
  const attackerPower = attacker ? effectivePower(attacker, 'attack') : null;
  const defenderPower = defender ? effectivePower(defender, 'defense') : null;
  const outcome = outcomeFor(attackerPower, defenderPower);
  const ratio = attackerPower !== null && defenderPower && defenderPower > 0 ? (attackerPower / defenderPower).toFixed(2) : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto border-white/15 bg-slate-900 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Crosshair className="h-5 w-5 text-rose-300" aria-hidden="true" />
            War calculator
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Compare visible unit combat values before committing an attack. The server remains authoritative for the actual result.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {availableUnits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-6 text-sm text-slate-400">
              Combat stats are not available in the current unit snapshot. Refresh the map snapshot or wait for the server combat-data update.
            </div>
          ) : (
            <>
              <section className="grid gap-3 md:grid-cols-2" aria-label="Combat participants">
                <UnitSelect label="Attacker" value={attackerId} units={ownUnits.length ? ownUnits : availableUnits} onChange={setAttackerId} icon={Swords} />
                <UnitSelect label="Defender" value={defenderId} units={opposingUnits.length ? opposingUnits : availableUnits} onChange={setDefenderId} icon={Shield} />
              </section>

              {attacker && defender ? (
                <section className="grid gap-3 md:grid-cols-[1fr_auto_1fr]" aria-label="Combat comparison">
                  <CombatCard label="Attacker" unit={attacker} mode="attack" accent="cyan" />
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-5">
                    <Swords className="h-5 w-5 text-rose-300" aria-hidden="true" />
                    <span className={`text-center text-sm font-semibold ${outcome.className}`}>{outcome.label}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Power ratio {ratio}</span>
                  </div>
                  <CombatCard label="Defender" unit={defender} mode="defense" accent="violet" />
                </section>
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-5 text-sm text-slate-400">Select two units with combat data to compare them.</div>
              )}

              <section className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4" aria-label="Combat estimate limitations">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold text-amber-100">Advisory estimate only</h3>
                    <p className="mt-1 text-xs leading-5 text-amber-100/70">
                      This comparison uses base attack/defense, firepower, and current health. Terrain, fortification, veteran modifiers, defenders in a stack, bombardment, and ruleset-specific combat bonuses are not yet exposed to the calculator. No win probability is implied.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const UnitSelect: React.FC<{
  label: string;
  value: string;
  units: Unit[];
  onChange: (value: string) => void;
  icon: React.ElementType;
}> = ({ label, value, units, onChange, icon: Icon }) => (
  <label className="rounded-xl border border-white/10 bg-white/5 p-3">
    <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
      <Icon className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" /> {label}
    </span>
    <select value={value} onChange={event => onChange(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20">
      {units.map(unit => <option key={unit.id} value={unit.id}>{formatName(unit.unitTypeId)} · {unit.x},{unit.y}</option>)}
    </select>
  </label>
);

const CombatCard: React.FC<{
  label: string;
  unit: Unit;
  mode: 'attack' | 'defense';
  accent: 'cyan' | 'violet';
}> = ({ label, unit, mode, accent }) => {
  const power = effectivePower(unit, mode);
  const accentClass = accent === 'cyan' ? 'text-cyan-200 border-cyan-300/20' : 'text-violet-200 border-violet-300/20';
  return (
    <div className={`rounded-xl border bg-white/5 p-4 ${accentClass}`}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{formatName(unit.unitTypeId)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Attack" value={statValue(unit.attack)} />
        <Stat label="Defense" value={statValue(unit.defense)} />
        <Stat label="Firepower" value={statValue(unit.firepower)} />
        <Stat label="Health" value={`${unit.hp}%`} icon={Heart} />
      </div>
      <div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-slate-500">
        Effective {mode}: <span className="font-semibold tabular-nums text-slate-200">{power === null ? 'Unavailable' : power.toFixed(1)}</span>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; icon?: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5">
    <div className="flex items-center gap-1 text-[10px] text-slate-500">{Icon && <Icon className="h-3 w-3" aria-hidden="true" />}{label}</div>
    <div className="mt-0.5 font-semibold tabular-nums text-slate-100">{value}</div>
  </div>
);
