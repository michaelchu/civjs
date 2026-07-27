import React from 'react';
import { useGameStore } from '../../store/gameStore';
import type { GameTab } from '../../types';
import clsx from 'clsx';

interface TabInfo {
  id: GameTab;
  label: string;
  icon: string;
  shortcut?: string;
}

const tabs: TabInfo[] = [
  { id: 'map', label: 'Map', icon: '🌍', shortcut: 'F1' },
  { id: 'government', label: 'Government', icon: '🏛️', shortcut: 'F2' },
  { id: 'research', label: 'Research', icon: '🧪', shortcut: 'F3' },
  { id: 'nations', label: 'Nations', icon: '🏳️', shortcut: 'F4' },
  { id: 'cities', label: 'Cities', icon: '🏰', shortcut: 'F5' },
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
    <div className="flex space-x-1">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={clsx(
            'flex items-center justify-center px-3 py-2 rounded-t-lg transition-colors duration-200',
            'focus:outline-none text-gray-300 hover:border-b-2 hover:border-blue-400',
            activeTab === tab.id ? 'border-b-2 border-blue-500' : ''
          )}
          title={tab.label}
          aria-label={`${tab.label} screen (${tab.shortcut})`}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <span className="text-lg" aria-hidden="true">
            {tab.icon}
          </span>
        </button>
      ))}
    </div>
  );
};
