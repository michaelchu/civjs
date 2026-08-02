/**
 * @module client/components/GameUI/CityHappinessTab
 * Defines the City Happiness Tab client UI component.
 */
import { Frown, Heart, Smile, Users } from 'lucide-react';
import type { City } from '../../types';
import { TabsContent } from '../ui/tabs';

export function CityHappinessTab({ city }: { city: City }) {
  const citizens = city.citizens;
  const state = city.celebrating
    ? { text: 'Celebrating', color: 'text-emerald-300', icon: Heart }
    : city.disorder
      ? { text: 'Disorder', color: 'text-rose-300', icon: Frown }
      : { text: 'Peace', color: 'text-cyan-300', icon: Smile };
  const StateIcon = state.icon;

  return (
    <TabsContent value="happiness" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1">
      {citizens && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4" />
            Citizens
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <CitizenMood label="Happy" value={citizens.happy} tone="emerald" icon={Heart} />
              <CitizenMood label="Content" value={citizens.content} tone="cyan" icon={Smile} />
            </div>
            <div className="space-y-3">
              <CitizenMood label="Unhappy" value={citizens.unhappy} tone="amber" icon={Frown} />
              <CitizenMood label="Angry" value={citizens.angry} tone="rose" icon={Frown} />
            </div>
          </div>
          {citizens.specialists && Object.keys(citizens.specialists).length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium">Specialists</h4>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(citizens.specialists).map(([type, count]) => (
                  <div
                    key={type}
                    className="flex items-center justify-between rounded border border-indigo-700/50 bg-indigo-950/30 p-2 text-sm"
                  >
                    <span className="capitalize">{type}</span>
                    <span className="font-semibold text-indigo-300">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 font-medium">
          <StateIcon className={`h-4 w-4 ${state.color}`} />
          City Status
        </h3>
        <div className="space-y-2 text-sm">
          <div className={`font-medium ${state.color}`}>{state.text}</div>
          {(city.pollution ?? 0) > 0 && (
            <div className="text-amber-300">Pollution: {city.pollution}</div>
          )}
          {city.rallyPoint && (
            <div className="text-cyan-300">
              Rally Point: ({city.rallyPoint.x}, {city.rallyPoint.y})
              {city.rallyPoint.persistent && ' (Persistent)'}
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  );
}

function CitizenMood({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'cyan' | 'amber' | 'rose';
  icon: typeof Heart;
}) {
  const colors = {
    emerald: 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300',
    cyan: 'border-cyan-700/50 bg-cyan-950/30 text-cyan-300',
    amber: 'border-amber-700/50 bg-amber-950/30 text-amber-300',
    rose: 'border-rose-700/50 bg-rose-950/30 text-rose-300',
  }[tone];
  return (
    <div className={`flex items-center justify-between rounded border p-3 ${colors}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium text-slate-100">{label}</span>
      </div>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
