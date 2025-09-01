/**
 * Flag Display Component
 *
 * Displays nation flags using Canvas 2D rendering, matching freeciv-web approach.
 * For now, shows a placeholder until flag graphics system is implemented.
 *
 * Reference: reference/freeciv-web/freeciv-web/src/main/webapp/javascript/nation.js:135-145
 */

import React, { useRef, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { cn } from '../../lib/utils';

interface FlagDisplayProps {
  nationId: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const FLAG_SIZES = {
  sm: { width: 24, height: 16 },
  md: { width: 29, height: 20 },
  lg: { width: 40, height: 28 },
};

export const FlagDisplay: React.FC<FlagDisplayProps> = ({ nationId, size = 'md', className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { nations } = useGameStore();

  const nation = nations[nationId];
  const dimensions = FLAG_SIZES[size];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nation) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // TODO: Implement actual flag rendering from sprites
    // For now, create a simple colored rectangle with nation initial
    const flagColor = nation.flag || '#4a5568';

    // Draw flag background
    ctx.fillStyle = flagColor;
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Draw nation initial
    ctx.fillStyle = 'white';
    ctx.font = `${Math.floor(dimensions.height * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const initial = nation.name.charAt(0).toUpperCase();
    ctx.fillText(initial, dimensions.width / 2, dimensions.height / 2);

    // Draw border
    ctx.strokeStyle = '#cbd5e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, dimensions.width, dimensions.height);
  }, [nation, dimensions, nationId]);

  if (!nation) {
    return (
      <div
        className={cn(
          'bg-gray-200 border border-gray-300 flex items-center justify-center',
          className
        )}
        style={{
          width: dimensions.width,
          height: dimensions.height,
        }}
      >
        <span className="text-xs text-gray-500">?</span>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={dimensions.width}
      height={dimensions.height}
      className={cn('border border-border rounded-sm', className)}
      title={`${nation.adjective} flag`}
    />
  );
};
