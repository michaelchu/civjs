import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';

export const EndGamePanel: React.FC = () => {
  const report = useGameStore(state => state.endGameReport);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (report) headingRef.current?.focus();
  }, [report]);

  if (!report) return null;
  const winnerIds = report.winnerPlayerIds ?? [report.winnerPlayerId];
  const won = currentPlayerId !== null && winnerIds.includes(currentPlayerId);
  const winners = report.standings.filter(standing => winnerIds.includes(standing.playerId));
  const victoryDescription =
    report.reason === 'world_peace'
      ? `${winners.map(winner => winner.civilization).join(', ')} achieved world peace`
      : report.reason === 'culture'
        ? `${winners[0]?.civilization ?? 'The winning civilization'} achieved cultural domination`
        : `${winners[0]?.civilization ?? 'The winning civilization'} achieved conquest`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-game-title"
    >
      <section className="max-h-full w-full max-w-3xl overflow-y-auto rounded-xl border border-gray-600 bg-gray-900 p-6 shadow-2xl">
        <h1
          id="end-game-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold text-white focus:outline-none"
        >
          {won ? 'Victory' : 'Game complete'}
        </h1>
        <p className="mt-2 text-gray-300">
          {victoryDescription} on turn {report.turn} ({formatYear(report.year)}).
        </p>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Final civilization standings</caption>
            <thead>
              <tr className="border-b border-gray-600 text-gray-300">
                <th scope="col" className="p-2">
                  Rank
                </th>
                <th scope="col" className="p-2">
                  Civilization
                </th>
                <th scope="col" className="p-2 text-right">
                  Score
                </th>
                <th scope="col" className="p-2 text-right">
                  Cities
                </th>
                <th scope="col" className="p-2 text-right">
                  Population
                </th>
                <th scope="col" className="p-2 text-right">
                  Units
                </th>
                <th scope="col" className="p-2 text-right">
                  Techs
                </th>
              </tr>
            </thead>
            <tbody>
              {report.standings.map((standing, index) => (
                <tr
                  key={standing.playerId}
                  className={
                    standing.playerId === currentPlayerId
                      ? 'border-b border-gray-700 bg-blue-950'
                      : 'border-b border-gray-700'
                  }
                >
                  <td className="p-2">{index + 1}</td>
                  <th scope="row" className="p-2 font-medium">
                    {standing.civilization}
                  </th>
                  <td className="p-2 text-right">{standing.score}</td>
                  <td className="p-2 text-right">{standing.cities}</td>
                  <td className="p-2 text-right">{standing.population}</td>
                  <td className="p-2 text-right">{standing.units}</td>
                  <td className="p-2 text-right">{standing.technologies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <a
          href="/"
          className="mt-6 inline-flex rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          Return to game list
        </a>
      </section>
    </div>
  );
};

const formatYear = (year: number): string => (year < 0 ? `${Math.abs(year)} BC` : `${year} AD`);
