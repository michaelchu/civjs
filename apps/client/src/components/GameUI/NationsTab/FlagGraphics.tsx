import React from 'react';

interface FlagGraphicsProps {
  nationId: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

/**
 * FlagGraphics component for displaying nation flags
 *
 * This component handles flag rendering for all 573+ Freeciv nations.
 * It supports fallback mechanisms for missing flag graphics.
 */
export const FlagGraphics: React.FC<FlagGraphicsProps> = ({
  nationId,
  size = 'medium',
  className = '',
}) => {
  const sizeMap = {
    small: { width: 24, height: 16 },
    medium: { width: 36, height: 24 },
    large: { width: 48, height: 32 },
  };

  const { width, height } = sizeMap[size];

  const flagSrc = `/flags/${nationId}.png`;
  const fallbackSrc = `/flags/unknown.svg`;

  const [imgSrc, setImgSrc] = React.useState(flagSrc);
  const [hasError, setHasError] = React.useState(false);

  const handleError = () => {
    if (!hasError && imgSrc === flagSrc) {
      setHasError(true);
      setImgSrc(fallbackSrc);
    }
  };

  const handleLoad = () => {
    setHasError(false);
  };

  // If SVG fallback also fails, render a text placeholder
  if (hasError && imgSrc === fallbackSrc) {
    return (
      <div
        className={`inline-flex items-center justify-center bg-gray-100 border border-gray-300 text-xs font-mono text-gray-600 rounded ${className}`}
        style={{ width, height, minWidth: width, minHeight: height }}
        title={`Flag for ${nationId} (no graphic available)`}
      >
        {nationId.substring(0, 3).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={`Flag of ${nationId}`}
      className={`inline-block border border-gray-300 ${className}`}
      style={{ width, height, minWidth: width, minHeight: height }}
      onError={handleError}
      onLoad={handleLoad}
      title={`Flag of ${nationId}`}
    />
  );
};

export default FlagGraphics;
