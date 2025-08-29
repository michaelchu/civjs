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
    'bg-gradient-to-b from-amber-100 to-yellow-200',
    {
      "md:bg-[url('/img/background.png')] md:bg-cover md:bg-center md:bg-no-repeat": showBackground,
    },
    className
  );

  return <div className={backgroundClasses}>{children}</div>;
};
