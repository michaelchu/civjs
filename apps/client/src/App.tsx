import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { GameCreationDialog } from './components/GameCreationDialog';
import { GameLobby } from './components/GameLobby';
import { GameRoute } from './components/GameRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create-game" element={<GameCreationDialog />} />
        <Route path="/browse-games" element={<GameLobby />} />
        <Route path="/game/:gameId" element={<GameRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
