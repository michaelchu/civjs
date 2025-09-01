import React, { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';

/**
 * Demo component to initialize research state for testing the technology tree
 * This simulates what would normally come from the server
 */
export const ResearchDemo: React.FC = () => {
  const { updateResearchState, setCurrentResearch } = useGameStore();

  useEffect(() => {
    // Initialize demo research state
    updateResearchState({
      bulbsAccumulated: 15,
      bulbsLastTurn: 5,
      researchedTechs: new Set(['alphabet', 'pottery']),
      availableTechs: new Set(['mysticism', 'mathematics', 'bronze_working', 'animal_husbandry']),
    });

    // Set current research to mysticism as demo
    setCurrentResearch('mysticism');
  }, [updateResearchState, setCurrentResearch]);

  return (
    <div className="absolute top-4 left-4 bg-gray-800 p-4 rounded-lg border border-gray-600 z-10">
      <h3 className="text-sm font-bold text-white mb-2">Demo Controls</h3>
      <div className="text-xs text-gray-300 space-y-1">
        <div>• Click technology nodes to view details</div>
        <div>• Double-click to set current research</div>
        <div>• Pan and zoom to navigate</div>
        <div>• Colors: White=Known, Green=Available, Blue=Current</div>
      </div>
    </div>
  );
};
