import React from 'react';
import type { Unit } from '../../types';

interface UnitSelectionOverlayProps {
  selectedUnit: Unit | null;
  mapRenderer: { mapToGuiVector: (x: number, y: number) => { guiDx: number; guiDy: number } } | null;
  viewport: { x: number; y: number; width: number; height: number };
}

export const UnitSelectionOverlay: React.FC<UnitSelectionOverlayProps> = ({
  selectedUnit,
  mapRenderer,
  viewport,
}) => {
  if (!selectedUnit || !mapRenderer) {
    return null;
  }

  // Convert unit map coordinates to screen coordinates
  const unitScreenPos = mapRenderer.mapToGuiVector(selectedUnit.x, selectedUnit.y);
  
  // Calculate position relative to viewport
  const screenX = unitScreenPos.guiDx - viewport.x;
  const screenY = unitScreenPos.guiDy - viewport.y;

  // Only render if unit is visible on screen
  if (screenX < -32 || screenX > viewport.width + 32 || screenY < -32 || screenY > viewport.height + 32) {
    return null;
  }

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: screenX - 2,
        top: screenY - 2,
        width: 32 + 4, // Tile size + border
        height: 32 + 4,
        border: '2px solid #ffff00',
        borderRadius: '4px',
        backgroundColor: 'rgba(255, 255, 0, 0.1)',
        animation: 'pulse 2s infinite',
        zIndex: 10,
      }}
    >
      {/* Optional: Unit info tooltip */}
      <div 
        className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded whitespace-nowrap"
        style={{ fontSize: '11px' }}
      >
        {selectedUnit.type} ({selectedUnit.hp}/{selectedUnit.hp})
      </div>
      
      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 255, 0, 0.7); }
          70% { box-shadow: 0 0 0 6px rgba(255, 255, 0, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 255, 0, 0); }
        }
      `}</style>
    </div>
  );
};