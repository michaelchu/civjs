import React from 'react';

export interface HudActionButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  label: string;
  icon: React.ElementType;
  active?: boolean;
  compact?: boolean;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
}

export const HudActionButton = React.forwardRef<HTMLButtonElement, HudActionButtonProps>(
  (
    {
      label,
      icon: Icon,
      active = false,
      compact = false,
      className,
      title,
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel ?? label}
      title={title ?? label}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
        active
          ? 'border-cyan-300/35 bg-cyan-300/15 text-cyan-100'
          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
      } disabled:cursor-not-allowed disabled:opacity-40 ${compact ? 'w-9 px-0' : ''} ${className ?? ''}`}
      {...props}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {!compact && <span className="hidden sm:inline">{label}</span>}
    </button>
  )
);

HudActionButton.displayName = 'HudActionButton';
