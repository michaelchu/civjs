import React from 'react';
import { useGameStore } from './store/gameStore';
import { ConnectionDialog } from './components/ConnectionDialog';
import { GameLayout } from './components/GameUI/GameLayout';

function App() {
  const { clientState } = useGameStore();

  // Show connection dialog if not connected
  if (clientState === 'initial') {
    return <ConnectionDialog />;
  }

  // Show main game layout for all other states
  return <GameLayout />;
}

export default App;