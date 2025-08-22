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
  { id: 'options', label: 'Options', icon: '⚙️', shortcut: 'F6' },
];

export const GameTabs: React.FC = () => {
  const { activeTab, setActiveTab } = useGameStore();

  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Handle F1-F6 keys for tab switching
      if (event.key >= 'F1' && event.key <= 'F6') {
        event.preventDefault();
        const tabIndex = parseInt(event.key.slice(1)) - 1;
        if (tabs[tabIndex]) {
          setActiveTab(tabs[tabIndex].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [setActiveTab]);

  return (
    <div className="flex space-x-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={clsx(
            'flex items-center space-x-2 px-4 py-2 rounded-t-lg transition-colors duration-200',
            'hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500',
            activeTab === tab.id
              ? 'bg-gray-800 text-white border-b-2 border-blue-500'
              : 'bg-gray-700 text-gray-300'
          )}
          title={`${tab.label} (${tab.shortcut})`}
        >
          <span className="text-lg">{tab.icon}</span>
          <span className="font-medium">{tab.label}</span>
          {tab.shortcut && (
            <span className="text-xs text-gray-400 ml-1">({tab.shortcut})</span>
          )}
        </button>
      ))}
    </div>
  );
};