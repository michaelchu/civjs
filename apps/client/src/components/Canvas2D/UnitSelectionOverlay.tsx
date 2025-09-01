import React from 'react';
import type { Unit } from '../../types';

/**
 * Draw an isometric diamond selection outline on a canvas
 * Based on the diamond rendering logic from MapRenderer.drawDiamond()
 */
const drawDiamondSelection = (canvas: HTMLCanvasElement, tileWidth: number, tileHeight: number) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Calculate center position (account for padding)
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const halfWidth = tileWidth / 2;
  const halfHeight = tileHeight / 2;

  // Draw the diamond outline with yellow stroke
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - halfHeight); // Top
  ctx.lineTo(centerX + halfWidth, centerY); // Right
  ctx.lineTo(centerX, centerY + halfHeight); // Bottom
  ctx.lineTo(centerX - halfWidth, centerY); // Left
  ctx.closePath();
  ctx.stroke();

  // Add a subtle fill with transparency
  ctx.fillStyle = 'rgba(255, 255, 0, 0.1)';
  ctx.fill();

  // Add inner diamond for enhanced visibility
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
  ctx.lineWidth = 1;
  const innerScale = 0.85;
  const innerHalfWidth = halfWidth * innerScale;
  const innerHalfHeight = halfHeight * innerScale;

  ctx.beginPath();
  ctx.moveTo(centerX, centerY - innerHalfHeight); // Top
  ctx.lineTo(centerX + innerHalfWidth, centerY); // Right
  ctx.lineTo(centerX, centerY + innerHalfHeight); // Bottom
  ctx.lineTo(centerX - innerHalfWidth, centerY); // Left
  ctx.closePath();
  ctx.stroke();
};

interface UnitSelectionOverlayProps {
  selectedUnit: Unit | null;
  mapRenderer: {
    mapToGuiVector: (x: number, y: number) => { guiDx: number; guiDy: number };
  } | null;
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

  // Get tile dimensions from MapRenderer (96x48 for isometric tiles)
  const tileWidth = 96;
  const tileHeight = 48;

  // Only render if unit is visible on screen (use actual tile dimensions)
  if (
    screenX < -tileWidth ||
    screenX > viewport.width + tileWidth ||
    screenY < -tileHeight ||
    screenY > viewport.height + tileHeight
  ) {
    return null;
  }

  return (
    <div className="absolute pointer-events-none" style={{ zIndex: 10 }}>
      {/* Canvas for drawing the isometric diamond selection */}
      <canvas
        width={tileWidth + 8} // Add padding for border
        height={tileHeight + 8}
        style={{
          position: 'absolute',
          left: screenX - 4, // Center the padding
          top: screenY - 4,
          animation: 'pulse 2s infinite',
        }}
        ref={canvasRef => {
          if (canvasRef) {
            drawDiamondSelection(canvasRef, tileWidth, tileHeight);
          }
        }}
      />
      {/* Optional: Unit info tooltip */}
      <div
        className="absolute bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded whitespace-nowrap"
        style={{
          fontSize: '11px',
          left: screenX + tileWidth / 2,
          top: screenY - 32,
          transform: 'translateX(-50%)',
        }}
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
