import React from 'react';
import { createPortal } from 'react-dom';

export const HudTooltip: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [isVisible, setIsVisible] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 0, top: 0 });

  const showTooltip = () => {
    const bounds = anchorRef.current?.getBoundingClientRect();
    if (!bounds) return;

    setPosition({ left: bounds.left + bounds.width / 2, top: bounds.top - 8 });
    setIsVisible(true);
  };

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex shrink-0"
        aria-label={label}
        title={label}
        tabIndex={0}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={showTooltip}
        onBlur={() => setIsVisible(false)}
      >
        {children}
      </span>
      {isVisible &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[2000] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
            style={{ left: position.left, top: position.top }}
          >
            {label}
          </span>,
          document.body
        )}
    </>
  );
};
