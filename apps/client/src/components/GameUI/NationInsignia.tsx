/**
 * @module client/components/GameUI/NationInsignia
 * Defines the Nation Insignia client UI component.
 */
import React from 'react';
import { cn } from '../../lib/utils';
import { getContrastingTextColor } from '../../utils/playerColors';

export interface NationInsigniaProps {
  color?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  shape?: 'dot' | 'badge';
  className?: string;
}

const sizeClasses = {
  sm: 'h-2 w-2',
  md: 'h-6 w-6',
  lg: 'h-9 w-9',
} as const;

const initialsFor = (name: string | undefined): string =>
  (name ?? '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
    .join('');

/** Color-backed identity placeholder that can later be replaced by a flag or portrait asset. */
export const NationInsignia: React.FC<NationInsigniaProps> = ({
  color = '#64748b',
  name,
  size = 'md',
  shape = 'badge',
  className,
}) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center justify-center border border-white/30 font-semibold text-white shadow-inner',
      sizeClasses[size],
      shape === 'dot' ? 'rounded-full' : 'rounded-md text-[9px]',
      className
    )}
    style={{ backgroundColor: color, color: getContrastingTextColor(color) }}
    aria-hidden="true"
  >
    {shape === 'badge' && size !== 'sm' ? initialsFor(name) : null}
  </span>
);
