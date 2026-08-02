/**
 * @module client/components/GameUI/GameTabs
 * Defines the Game Tabs client UI component.
 */
import React from 'react';
import { Building2, Flag, FlaskConical, Landmark, Map as MapIcon } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import type { GameTab } from '../../types';
import clsx from 'clsx';

interface TabInfo {
  id: GameTab;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
}

const tabs: TabInfo[] = [
  { id: 'map', label: 'Map', icon: MapIcon, shortcut: 'F1' },
  { id: 'government', label: 'Government', icon: Landmark, shortcut: 'F2' },
  { id: 'research', label: 'Research', icon: FlaskConical, shortcut: 'F3' },
  { id: 'nations', label: 'Nations', icon: Flag, shortcut: 'F4' },
  { id: 'cities', label: 'Cities', icon: Building2, shortcut: 'F5' },
];

const shortcutTabs: GameTab[] = ['map', 'government', 'research', 'nations', 'cities', 'options'];

export const GameTabs: React.FC = () => {
  const activeTab = useGameStore(state => state.activeTab);
  const setActiveTab = useGameStore(state => state.setActiveTab);

  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Settings remains available with F6 even though it lives in the game menu.
      if (event.key >= 'F1' && event.key <= 'F6') {
        event.preventDefault();
        const tabIndex = parseInt(event.key.slice(1)) - 1;
        if (shortcutTabs[tabIndex]) {
          setActiveTab(shortcutTabs[tabIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [setActiveTab]);

  return (
    <div className="flex gap-1">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex h-9 w-10 items-center justify-center rounded-lg border text-slate-400 transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70',
              activeTab === tab.id
                ? 'border-cyan-300/30 bg-cyan-300/15 text-cyan-100 shadow-inner'
                : 'border-transparent hover:border-white/10 hover:bg-white/10 hover:text-white'
            )}
            title={tab.label}
            aria-label={`${tab.label} screen (${tab.shortcut})`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};
