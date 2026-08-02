/**
 * @module client/components/GameUI/TileInfoOverlay
 * Presents the information available for a map tile in the current client
 * snapshot.
 */
import React from 'react';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { HudDialogContent } from './HudDialogContent';
import type { City, Tile, Unit } from '../../types';

interface TileInfoOverlayProps {
  tile: Tile | null;
  x: number;
  y: number;
  units: Unit[];
  city?: City;
  isOpen: boolean;
  onClose: () => void;
}

const formatLabel = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 border-b border-white/10 py-2 last:border-0">
    <dt className="text-slate-400">{label}</dt>
    <dd className="text-right font-medium text-slate-100">{value}</dd>
  </div>
);

export const TileInfoOverlay: React.FC<TileInfoOverlayProps> = ({
  tile,
  x,
  y,
  units,
  city,
  isOpen,
  onClose,
}) => (
  <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
    <HudDialogContent className="h-auto max-h-[85vh] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Tile Info</DialogTitle>
        <DialogDescription>
          Location ({x}, {y}) · {tile?.known ? 'Known tile' : 'Unknown tile'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-white/5 p-3">
          <h3 className="mb-2 text-sm font-semibold text-cyan-100">Terrain</h3>
          <dl className="text-sm">
            <InfoRow label="Terrain" value={tile ? formatLabel(tile.terrain) : 'Unknown'} />
            <InfoRow label="Elevation" value={tile?.elevation ?? 'Unknown'} />
            <InfoRow
              label="Resource"
              value={tile?.resource ? formatLabel(tile.resource) : 'None'}
            />
            <InfoRow
              label="Improvements"
              value={
                tile?.improvements?.length
                  ? tile.improvements.map(formatLabel).join(', ')
                  : tile?.hasRailroad
                    ? 'Railroad'
                    : tile?.hasRoad
                      ? 'Road'
                      : 'None'
              }
            />
          </dl>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/5 p-3">
          <h3 className="mb-2 text-sm font-semibold text-violet-100">Control</h3>
          <dl className="text-sm">
            <InfoRow label="Owner" value={tile?.owner ?? 'Unclaimed'} />
            <InfoRow label="Claimed by" value={tile?.claimer ?? 'None'} />
            <InfoRow label="Visibility" value={tile?.visible ? 'Visible' : 'Not visible'} />
            <InfoRow label="City" value={city?.name ?? 'None'} />
          </dl>
        </section>
      </div>

      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <h3 className="mb-2 text-sm font-semibold text-amber-100">Units ({units.length})</h3>
        {units.length > 0 ? (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {units.map(unit => (
              <li key={unit.id} className="rounded border border-white/10 bg-black/10 px-2 py-1.5">
                <div className="font-medium text-slate-100">{formatLabel(unit.unitTypeId)}</div>
                <div className="text-xs text-slate-400">
                  {unit.playerId} · HP {unit.hp} · Moves {unit.movesLeft}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No units are present on this tile.</p>
        )}
      </section>
    </HudDialogContent>
  </Dialog>
);
