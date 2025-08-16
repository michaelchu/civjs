import { Link } from 'react-router-dom';

interface HomePageProps {
  connected: boolean;
}

export default function HomePage({ connected }: HomePageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-4xl font-bold text-gray-800 mb-4 text-center">
          CivJS
        </h1>
        <p className="text-gray-600 mb-8 text-center">
          Browser-based Civilization Game
        </p>

        <div className="space-y-4">
          <Link
            to="/games"
            className={`block w-full text-center px-6 py-3 rounded-lg font-medium transition-colors ${
              connected
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            onClick={e => !connected && e.preventDefault()}
          >
            Browse Games
          </Link>

          <Link
            to="/games/create"
            className={`block w-full text-center px-6 py-3 rounded-lg font-medium transition-colors ${
              connected
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            onClick={e => !connected && e.preventDefault()}
          >
            Create New Game
          </Link>
        </div>

        {!connected && (
          <p className="text-red-600 text-sm text-center mt-4">
            Please wait for server connection...
          </p>
        )}
      </div>
    </div>
  );
}
