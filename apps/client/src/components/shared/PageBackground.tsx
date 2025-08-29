import React from 'react';
import { clsx } from 'clsx';

interface PageBackgroundProps {
  children: React.ReactNode;
  className?: string;
  mobileBreakpoint?: 'md' | 'lg';
}

export const PageBackground: React.FC<PageBackgroundProps> = ({
  children,
  className,
  mobileBreakpoint = 'md',
}) => {
  const backgroundClasses = clsx(
    'bg-gradient-to-b from-amber-100 to-yellow-200',
    {
      'md:bg-[url(\'/img/background.png\')]': mobileBreakpoint === 'md',
      'lg:bg-[url(\'/img/background.png\')]': mobileBreakpoint === 'lg',
    },
    {
      'md:bg-cover md:bg-center md:bg-no-repeat': mobileBreakpoint === 'md',
      'lg:bg-cover lg:bg-center lg:bg-no-repeat': mobileBreakpoint === 'lg',
    },
    className
  );

  return <div className={backgroundClasses}>{children}</div>;
};