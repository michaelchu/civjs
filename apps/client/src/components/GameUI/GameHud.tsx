import * as React from 'react';
import { cn } from '../../lib/utils';

export interface GameHudProps {
  top?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  bottomLeft?: React.ReactNode;
  bottomCenter?: React.ReactNode;
  bottomRight?: React.ReactNode;
  className?: string;
}

interface HudRegionProps {
  name: string;
  className: string;
  children?: React.ReactNode;
}

const HudRegion: React.FC<HudRegionProps> = ({ name, className, children }) => {
  if (!children) return null;

  return (
    <div data-hud-region={name} className={cn('pointer-events-none absolute flex', className)}>
      <div className="pointer-events-auto">{children}</div>
    </div>
  );
};

/** Map-first overlay layer with stable named regions for subsequent HUD slices. */
export const GameHud: React.FC<GameHudProps> = ({
  top,
  left,
  right,
  bottomLeft,
  bottomCenter,
  bottomRight,
  className,
}) => (
  <div
    data-game-hud
    className={cn('pointer-events-none absolute inset-0 z-[1000] overflow-hidden', className)}
  >
    <HudRegion name="top" className="inset-x-3 top-3 justify-center sm:inset-x-4 sm:top-4">
      {top}
    </HudRegion>
    <HudRegion name="left" className="bottom-24 left-3 top-20 items-center sm:left-4">
      {left}
    </HudRegion>
    <HudRegion name="right" className="bottom-24 right-3 top-20 items-start sm:right-4">
      {right}
    </HudRegion>
    <HudRegion name="bottom-left" className="bottom-3 left-3 items-end sm:bottom-4 sm:left-4">
      {bottomLeft}
    </HudRegion>
    <HudRegion
      name="bottom-center"
      className="bottom-28 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 items-end sm:bottom-4"
    >
      {bottomCenter}
    </HudRegion>
    <HudRegion name="bottom-right" className="bottom-3 right-3 items-end sm:bottom-4 sm:right-4">
      {bottomRight}
    </HudRegion>
  </div>
);
