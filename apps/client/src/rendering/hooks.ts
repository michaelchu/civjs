// React hooks for the rendering system
import { useState, useEffect } from 'react';
import { onLoadingStateChange, getLoadingState } from './mapview';

export interface LoadingState {
  isLoading: boolean;
  progress: number;
  message: string;
}

/**
 * React hook to monitor sprite loading state
 * Components can use this to show loading indicators
 */
export function useSpriteLoadingState(): LoadingState {
  const [loadingState, setLoadingState] =
    useState<LoadingState>(getLoadingState());

  useEffect(() => {
    const unsubscribe = onLoadingStateChange(setLoadingState);
    return unsubscribe;
  }, []);

  return loadingState;
}

/**
 * React hook to check if sprites are fully loaded
 */
export function useSpritesLoaded(): boolean {
  const loadingState = useSpriteLoadingState();
  return !loadingState.isLoading && loadingState.progress === 100;
}
