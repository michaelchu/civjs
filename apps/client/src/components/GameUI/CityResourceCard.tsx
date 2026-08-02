import type { LucideIcon } from 'lucide-react';

interface CityResourceCardProps {
  label: string;
  value: number | null | undefined;
  icon: LucideIcon;
  baseValue?: number;
}

function valueColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'text-slate-500';
  if (value > 0) return 'text-emerald-300';
  if (value < 0) return 'text-rose-300';
  return 'text-slate-300';
}

function cardColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'bg-slate-800/70 border-slate-700';
  if (value > 0) return 'bg-emerald-950/40 border-emerald-700/50';
  if (value < 0) return 'bg-rose-950/40 border-rose-700/50';
  return 'bg-slate-800/70 border-slate-700';
}

export function CityResourceCard({ label, value, icon: Icon, baseValue }: CityResourceCardProps) {
  const formatted =
    value === null || value === undefined ? '--' : `${value > 0 ? '+' : ''}${value}`;
  return (
    <div className={`flex flex-col items-center rounded-lg border p-3 ${cardColor(value)}`}>
      <Icon className="mb-1 h-5 w-5" />
      <div className={`text-lg font-semibold ${valueColor(value)}`}>{formatted}</div>
      <div className="text-center text-xs">
        <div>{label}</div>
        {baseValue !== undefined && baseValue !== value && (
          <div className="text-slate-500">({baseValue} base)</div>
        )}
      </div>
    </div>
  );
}
