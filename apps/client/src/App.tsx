import React from 'react';
import { useGameStore } from './store/gameStore';
import { HomePage } from './components/HomePage';
import { GameCreationDialog } from './components/GameCreationDialog';
import { GameLobby } from './components/GameLobby';
import { ConnectionDialog } from './components/ConnectionDialog';
import { GameLayout } from './components/GameUI/GameLayout';

function App() {
  const { clientState } = useGameStore();

  switch (clientState) {
    case 'initial':
      return <HomePage />;
    
    case 'creating_game':
      return <GameCreationDialog />;
    
    case 'browsing_games':
      return <GameLobby />;
    
    case 'connecting':
    case 'waiting_for_players':
    case 'joining_game':
      return <ConnectionDialog />;
    
    case 'preparing':
    case 'running':
    case 'over':
      return <GameLayout />;
    
    default:
      return <HomePage />;
  }
}

export default App;