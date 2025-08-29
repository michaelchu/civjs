import React from 'react';

interface TileHoverOverlayProps {
  tileInfo: string | null;
}

export const TileHoverOverlay: React.FC<TileHoverOverlayProps> = ({ tileInfo }) => {
  if (!tileInfo) return null;

  return (
    <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white px-3 py-2 rounded-md text-sm font-mono pointer-events-none z-10">
      {tileInfo}
    </div>
  );
};
