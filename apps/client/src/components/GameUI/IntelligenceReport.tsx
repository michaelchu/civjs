import React, { useMemo } from 'react';
import { Eye, Flag, MapPin, Radar, ShieldAlert, Swords, Users } from 'lucide-react';
import type { City, DiplomacyNation, Player, Tile, Unit } from '../../types';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { NationInsignia } from './NationInsignia';
import { HudDialogContent } from './HudDialogContent';

interface IntelligenceReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Record<string, Player>;
  diplomacy?: { nations: DiplomacyNation[] };
  cities: Record<string, City>;
  units: Record<string, Unit>;
  tiles: Record<string, Tile>;
  currentPlayerId: string;
  researchedTechCount: number;
}

interface IntelligenceRow {
  id: string;
  player: Player;
  nation?: DiplomacyNation;
  known: boolean;
  cities: number;
  units: number;
  territory: number;
  research: number | null;
  focus?: { x: number; y: number; kind: 'city' | 'unit'; id: string };
}

const relationLabels: Record<DiplomacyNation['relation']['state'], string> = {
  no_contact: 'No contact',
  war: 'War',
  ceasefire: 'Ceasefire',
  armistice: 'Armistice',
  peace: 'Peace',
  alliance: 'Alliance',
  team: 'Team',
};

const relationClasses: Record<DiplomacyNation['relation']['state'], string> = {
  no_contact: 'border-slate-400/20 bg-slate-400/10 text-slate-400',
  war: 'border-rose-300/30 bg-rose-400/15 text-rose-200',
  ceasefire: 'border-amber-300/30 bg-amber-400/15 text-amber-200',
  armistice: 'border-amber-300/30 bg-amber-400/15 text-amber-200',
  peace: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200',
  alliance: 'border-cyan-300/25 bg-cyan-400/10 text-cyan-200',
  team: 'border-violet-300/25 bg-violet-400/10 text-violet-200',
};

const isObserved = (tile: Tile | undefined): boolean => Boolean(tile?.known || tile?.visible);

const formatName = (value: string): string =>
  value
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

export const IntelligenceReport: React.FC<IntelligenceReportProps> = ({
  open,
  onOpenChange,
  players,
  diplomacy,
  cities,
  units,
  tiles,
  currentPlayerId,
  researchedTechCount,
}) => {
  const rows = useMemo<IntelligenceRow[]>(() => {
    const nationsById = new Map((diplomacy?.nations ?? []).map(nation => [nation.id, nation]));
    const observedTiles = Object.values(tiles).filter(tile => isObserved(tile));
    const visibleCities = Object.values(cities).filter(city => {
      const tile = tiles[`${city.x},${city.y}`];
      return city.playerId === currentPlayerId || isObserved(tile);
    });
    const visibleUnits = Object.values(units).filter(unit => {
      const tile = tiles[`${unit.x},${unit.y}`];
      return unit.playerId === currentPlayerId || isObserved(tile);
    });

    return Object.values(players)
      .filter(player => player.isActive)
      .map(player => {
        const nation = nationsById.get(player.id);
        const known = player.id === currentPlayerId || Boolean(nation?.known);
        const playerCities = visibleCities.filter(city => city.playerId === player.id);
        const playerUnits = visibleUnits.filter(unit => unit.playerId === player.id);
        const playerTerritory = observedTiles.filter(tile => tile.owner === player.id).length;
        const focusUnit = playerUnits[0];
        const focusCity = playerCities[0];
        const focus =
          known && (focusUnit || focusCity)
            ? focusUnit
              ? { x: focusUnit.x, y: focusUnit.y, kind: 'unit' as const, id: focusUnit.id }
              : { x: focusCity!.x, y: focusCity!.y, kind: 'city' as const, id: focusCity!.id }
            : undefined;

        return {
          id: player.id,
          player,
          nation,
          known,
          cities: known ? playerCities.length : 0,
          units: known ? playerUnits.length : 0,
          territory: known ? playerTerritory : 0,
          research: player.id === currentPlayerId ? researchedTechCount : null,
          focus,
        };
      })
      .sort((left, right) => {
        if (left.id === currentPlayerId) return -1;
        if (right.id === currentPlayerId) return 1;
        return left.player.name.localeCompare(right.player.name);
      });
  }, [cities, currentPlayerId, diplomacy, players, researchedTechCount, tiles, units]);

  const knownRows = rows.filter(row => row.known && row.id !== currentPlayerId);
  const pendingProposals = knownRows.filter(
    row => row.nation?.relation.proposal?.status === 'pending'
  ).length;
  const wars = knownRows.filter(row => row.nation?.relation.state === 'war').length;
  const observedForces = knownRows.reduce((sum, row) => sum + row.units, 0);

  const focusRow = (row: IntelligenceRow) => {
    if (!row.focus) return;
    document.dispatchEvent(
      new CustomEvent('center-map-on-tile', { detail: { x: row.focus.x, y: row.focus.y } })
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <HudDialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Radar className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Intelligence report
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Compare known nations using diplomatic records and map observations. Hidden information
            remains undisclosed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-4" aria-label="Intelligence summary">
            <SummaryCard
              icon={Users}
              label="Known contacts"
              value={`${knownRows.length}`}
              detail={`${Math.max(rows.length - knownRows.length - 1, 0)} unknown nations`}
            />
            <SummaryCard
              icon={Swords}
              label="Observed foreign units"
              value={`${observedForces}`}
              detail="Current map visibility"
            />
            <SummaryCard
              icon={ShieldAlert}
              label="Wars"
              value={`${wars}`}
              detail="Known hostile relations"
            />
            <SummaryCard
              icon={Flag}
              label="Pending proposals"
              value={`${pendingProposals}`}
              detail="Diplomatic actions"
            />
          </section>

          <section
            className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-4"
            aria-label="Intelligence coverage"
          >
            <div className="flex items-start gap-3">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-cyan-100">
                  Observation-based intelligence
                </h3>
                <p className="mt-1 text-xs leading-5 text-cyan-100/70">
                  Foreign city, unit, and territory counts only include entities currently visible
                  or previously known on the map. Per-nation technology, income, and total military
                  strength are not exposed by the backend yet.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="intelligence-standings-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3
                id="intelligence-standings-heading"
                className="text-sm font-semibold text-slate-100"
              >
                Nation comparison
              </h3>
              <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Known data only
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[680px] border-collapse text-xs">
                <thead className="bg-white/5 text-left text-[10px] uppercase tracking-[0.1em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">Nation</th>
                    <th className="px-3 py-2.5">Relation</th>
                    <th className="px-3 py-2.5 text-right">Cities</th>
                    <th className="px-3 py-2.5 text-right">Units</th>
                    <th className="px-3 py-2.5 text-right">Territory</th>
                    <th className="px-3 py-2.5">Research</th>
                    <th className="px-3 py-2.5">Map</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-t border-white/10 text-slate-300">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <NationInsignia
                            color={row.player.color}
                            name={row.player.name}
                            size="sm"
                            shape="dot"
                          />
                          <div>
                            <div className="font-semibold text-slate-100">
                              {row.id === currentPlayerId
                                ? `${row.player.name} (You)`
                                : row.known
                                  ? (row.nation?.civilization ?? row.player.nation)
                                  : 'Unknown nation'}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {row.id === currentPlayerId
                                ? formatName(row.player.government)
                                : row.known
                                  ? row.nation?.leaderName
                                  : 'Identity hidden until contact'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {row.id === currentPlayerId ? (
                          <span className="rounded border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-cyan-200">
                            Your empire
                          </span>
                        ) : row.known && row.nation ? (
                          <span
                            className={`rounded border px-1.5 py-0.5 ${relationClasses[row.nation.relation.state]}`}
                          >
                            {relationLabels[row.nation.relation.state]}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.known ? row.cities : '—'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.known ? row.units : '—'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.known ? row.territory : '—'}
                      </td>
                      <td className="px-3 py-3">
                        {row.research === null ? (
                          <span className="text-slate-600">Unreported</span>
                        ) : (
                          row.research
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {row.focus ? (
                          <button
                            type="button"
                            onClick={() => focusRow(row)}
                            aria-label={`Focus known ${row.focus.kind} for ${row.player.name}`}
                            className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                          >
                            <MapPin className="h-3 w-3" aria-hidden="true" /> Focus
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
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
