import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { Unit } from '../../types';

interface CityNameDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onFoundCity: (cityName: string) => void;
  unit: Unit | null;
  suggestedName?: string;
}

export const CityNameDialog: React.FC<CityNameDialogProps> = ({
  isOpen,
  onClose,
  onFoundCity,
  unit,
  suggestedName = '',
}) => {
  const [cityName, setCityName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Generate a default city name based on location
  const generateDefaultName = useCallback((): string => {
    if (!unit) return 'New City';

    const cityNames = [
      'New Rome',
      'Alexandria',
      'Byzantium',
      'Carthage',
      'Babylon',
      'Memphis',
      'Thebes',
      'Damascus',
      'Antioch',
      'Palmyra',
      'New Athens',
      'Corinth',
      'Sparta',
      'Troy',
      'Marathon',
      'New York',
      'Boston',
      'Philadelphia',
      'Charleston',
      'Savannah',
    ];

    // Use position to semi-deterministically pick a name
    const index = (unit.x + unit.y * 17) % cityNames.length;
    return cityNames[index];
  }, [unit]);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setCityName(suggestedName || generateDefaultName());
      setIsLoading(false);
      setErrorMessage(null);
    }
  }, [isOpen, suggestedName, generateDefaultName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = cityName.trim();
    if (!trimmedName) {
      // Focus back to input if empty
      const input = e.currentTarget.querySelector('input');
      input?.focus();
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await onFoundCity(trimmedName);
      onClose();
    } catch (error) {
      console.error('Error founding city:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to found city';
      setErrorMessage(errorMsg);
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (!isLoading) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoading) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={!isLoading ? onClose : undefined}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Found New City</DialogTitle>
            <DialogDescription>
              {unit && (
                <>
                  Your settler at position ({unit.x}, {unit.y}) is ready to found a new city.
                  <br />
                  What would you like to name this city?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="city-name" className="text-sm font-medium">
                City Name
              </label>
              <Input
                id="city-name"
                value={cityName}
                onChange={e => setCityName(e.target.value)}
                placeholder="Enter city name..."
                maxLength={50}
                autoFocus
                disabled={isLoading}
                className="w-full"
              />
            </div>
            {errorMessage && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                <strong>Cannot found city:</strong> {errorMessage}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !cityName.trim()}>
              {isLoading ? 'Founding...' : 'Found City'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
