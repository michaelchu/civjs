import { useState } from 'react';
import {
  GameDialog,
  GameDialogContent,
  GameDialogDescription,
  GameDialogFooter,
  GameDialogHeader,
  GameDialogTitle,
  GameDialogTrigger,
} from '../ui/game-dialog';
import { GameButton } from '../ui/game-button';

const themes = ['medieval', 'futuristic', 'parchment', 'stone', 'metal'] as const;

export function GameDialogExample() {
  const [selectedTheme, setSelectedTheme] = useState<(typeof themes)[number]>('medieval');

  return (
    <div className="p-8 space-y-6 bg-gradient-to-b from-slate-900 to-slate-800 min-h-screen">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-white">Game Dialog Themes</h1>
        <div className="flex flex-wrap gap-3 justify-center">
          {themes.map(theme => (
            <GameButton
              key={theme}
              theme={theme}
              variant={selectedTheme === theme ? 'default' : 'outline'}
              onClick={() => setSelectedTheme(theme)}
              className="capitalize"
            >
              {theme}
            </GameButton>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Basic Dialog */}
        <GameDialog>
          <GameDialogTrigger asChild>
            <GameButton theme={selectedTheme}>Basic Dialog</GameButton>
          </GameDialogTrigger>
          <GameDialogContent theme={selectedTheme}>
            <GameDialogHeader>
              <GameDialogTitle theme={selectedTheme}>Welcome to the Empire</GameDialogTitle>
              <GameDialogDescription theme={selectedTheme}>
                Your civilization awaits your guidance, noble leader.
              </GameDialogDescription>
            </GameDialogHeader>
            <GameDialogFooter>
              <GameButton theme={selectedTheme} variant="outline">
                Cancel
              </GameButton>
              <GameButton theme={selectedTheme}>Continue</GameButton>
            </GameDialogFooter>
          </GameDialogContent>
        </GameDialog>

        {/* City Dialog */}
        <GameDialog>
          <GameDialogTrigger asChild>
            <GameButton theme={selectedTheme} variant="secondary">
              City Management
            </GameButton>
          </GameDialogTrigger>
          <GameDialogContent theme={selectedTheme} size="lg">
            <GameDialogHeader>
              <GameDialogTitle theme={selectedTheme}>City of Rome</GameDialogTitle>
              <GameDialogDescription theme={selectedTheme}>
                Population: 12 | Culture: 45 | Production: 8
              </GameDialogDescription>
            </GameDialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <h4 className="font-semibold mb-2">Buildings</h4>
                  <ul className="space-y-1 text-xs opacity-80">
                    <li>• Granary</li>
                    <li>• Barracks</li>
                    <li>• Library</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Production Queue</h4>
                  <ul className="space-y-1 text-xs opacity-80">
                    <li>• Warrior (2 turns)</li>
                    <li>• Temple (8 turns)</li>
                  </ul>
                </div>
              </div>
            </div>
            <GameDialogFooter>
              <GameButton theme={selectedTheme} variant="outline">
                Close
              </GameButton>
              <GameButton theme={selectedTheme}>Manage Production</GameButton>
            </GameDialogFooter>
          </GameDialogContent>
        </GameDialog>

        {/* Destructive Dialog */}
        <GameDialog>
          <GameDialogTrigger asChild>
            <GameButton theme={selectedTheme} variant="destructive">
              Declare War
            </GameButton>
          </GameDialogTrigger>
          <GameDialogContent theme={selectedTheme}>
            <GameDialogHeader>
              <GameDialogTitle theme={selectedTheme}>Declare War?</GameDialogTitle>
              <GameDialogDescription theme={selectedTheme}>
                This action will declare war on the Roman Empire. This cannot be undone and will
                have serious diplomatic consequences.
              </GameDialogDescription>
            </GameDialogHeader>
            <GameDialogFooter>
              <GameButton theme={selectedTheme} variant="outline">
                Cancel
              </GameButton>
              <GameButton theme={selectedTheme} variant="destructive">
                Declare War
              </GameButton>
            </GameDialogFooter>
          </GameDialogContent>
        </GameDialog>

        {/* Technology Dialog */}
        <GameDialog>
          <GameDialogTrigger asChild>
            <GameButton theme={selectedTheme} variant="outline">
              Research
            </GameButton>
          </GameDialogTrigger>
          <GameDialogContent theme={selectedTheme} size="xl">
            <GameDialogHeader>
              <GameDialogTitle theme={selectedTheme}>Technology Research</GameDialogTitle>
              <GameDialogDescription theme={selectedTheme}>
                Choose your next research target to advance your civilization.
              </GameDialogDescription>
            </GameDialogHeader>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                'Bronze Working',
                'Pottery',
                'Animal Husbandry',
                'Archery',
                'Mysticism',
                'Warrior Code',
              ].map(tech => (
                <GameButton
                  key={tech}
                  theme={selectedTheme}
                  variant="outline"
                  size="sm"
                  className="h-auto py-3 px-2 text-xs whitespace-normal"
                >
                  {tech}
                </GameButton>
              ))}
            </div>
            <GameDialogFooter>
              <GameButton theme={selectedTheme} variant="outline">
                Cancel
              </GameButton>
              <GameButton theme={selectedTheme}>Start Research</GameButton>
            </GameDialogFooter>
          </GameDialogContent>
        </GameDialog>

        {/* Settings Dialog */}
        <GameDialog>
          <GameDialogTrigger asChild>
            <GameButton theme={selectedTheme} variant="ghost">
              Settings
            </GameButton>
          </GameDialogTrigger>
          <GameDialogContent theme={selectedTheme} size="lg">
            <GameDialogHeader>
              <GameDialogTitle theme={selectedTheme}>Game Settings</GameDialogTitle>
              <GameDialogDescription theme={selectedTheme}>
                Configure your gameplay preferences.
              </GameDialogDescription>
            </GameDialogHeader>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Music Volume</span>
                <div className="w-32 h-2 bg-black/20 rounded-full">
                  <div className="w-3/4 h-full bg-current rounded-full"></div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Auto-Save</span>
                <GameButton theme={selectedTheme} size="sm">
                  Enabled
                </GameButton>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Animation Speed</span>
                <GameButton theme={selectedTheme} size="sm" variant="outline">
                  Fast
                </GameButton>
              </div>
            </div>
            <GameDialogFooter>
              <GameButton theme={selectedTheme} variant="outline">
                Cancel
              </GameButton>
              <GameButton theme={selectedTheme}>Save Settings</GameButton>
            </GameDialogFooter>
          </GameDialogContent>
        </GameDialog>

        {/* Large Content Dialog */}
        <GameDialog>
          <GameDialogTrigger asChild>
            <GameButton theme={selectedTheme} size="lg">
              Diplomacy
            </GameButton>
          </GameDialogTrigger>
          <GameDialogContent theme={selectedTheme} size="xl" showCloseButton={false}>
            <GameDialogHeader>
              <GameDialogTitle theme={selectedTheme}>Foreign Relations</GameDialogTitle>
              <GameDialogDescription theme={selectedTheme}>
                Manage your relationships with other civilizations.
              </GameDialogDescription>
            </GameDialogHeader>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {[
                'Roman Empire',
                'Greek City-States',
                'Egyptian Kingdom',
                'Babylonian Empire',
                'Chinese Dynasty',
              ].map((civ, i) => (
                <div key={civ} className="border border-current/20 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold">{civ}</h4>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        i === 0
                          ? 'bg-red-500/20 text-red-300'
                          : i === 1
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-yellow-500/20 text-yellow-300'
                      }`}
                    >
                      {i === 0 ? 'War' : i === 1 ? 'Allied' : 'Neutral'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <GameButton theme={selectedTheme} size="sm" variant="outline">
                      Trade
                    </GameButton>
                    <GameButton theme={selectedTheme} size="sm" variant="outline">
                      Embassy
                    </GameButton>
                    <GameButton
                      theme={selectedTheme}
                      size="sm"
                      variant={i === 0 ? 'default' : 'destructive'}
                    >
                      {i === 0 ? 'Peace' : 'War'}
                    </GameButton>
                  </div>
                </div>
              ))}
            </div>
            <GameDialogFooter>
              <GameButton theme={selectedTheme}>Close</GameButton>
            </GameDialogFooter>
          </GameDialogContent>
        </GameDialog>
      </div>
    </div>
  );
}
