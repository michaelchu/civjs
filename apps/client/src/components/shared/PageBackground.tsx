import React from 'react';
import { clsx } from 'clsx';

interface PageBackgroundProps {
  children: React.ReactNode;
  className?: string;
  showBackground?: boolean;
}

export const PageBackground: React.FC<PageBackgroundProps> = ({
  children,
  className,
  showBackground = true,
}) => {
  const backgroundClasses = clsx(
    {
      // Use solid civ-cream background when showBackground is false
      'bg-civ-cream': !showBackground,
      // Use gradient background by default
      'bg-gradient-to-b from-civ-cream-light to-civ-cream': showBackground,
      // Use background image on medium screens and up when showBackground is true
      "md:bg-[url('/img/background.png')] md:bg-cover md:bg-center md:bg-no-repeat": showBackground,
    },
    className
  );

  return <div className={backgroundClasses}>{children}</div>;
};
