/**
 * @module client/App
 * Composes the client application routes.
 */
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { GameCreationDialog } from './components/GameCreationDialog';
import { TerrainSettingsDialog } from './components/TerrainSettingsDialog';
import { GameLobby } from './components/GameLobby';
import { GameRoute } from './components/GameRoute';
import { BrowserParityFixture } from './components/BrowserParityFixture';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create-game" element={<GameCreationDialog />} />
        <Route path="/terrain-settings" element={<TerrainSettingsDialog />} />
        <Route path="/browse-games" element={<GameLobby />} />
        <Route path="/game/:gameId" element={<GameRoute />} />
        {import.meta.env.DEV && (
          <Route path="/test/browser-parity" element={<BrowserParityFixture />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
