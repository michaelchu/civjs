import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Building2, Users, Wheat, Shield, TrendingUp, Hammer, MapPin } from 'lucide-react';
import type { City } from '../../types';

interface CityInfoOverlayProps {
  city: City | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * CityInfoOverlay displays detailed information about a city when right-clicked.
 *
 * Based on freeciv-web's show_city_dialog functionality:
 * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/city.js:138-226
 * - Shows city name and size in title
 * - Displays resource output (food, shields, trade)
 * - Lists buildings and current production
 * - Shows city position
 */
export const CityInfoOverlay: React.FC<CityInfoOverlayProps> = ({ city, isOpen, onClose }) => {
  if (!city) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {city.name}
          </DialogTitle>
          <DialogDescription>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                Position ({city.x}, {city.y})
              </div>
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                Size {city.size}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Resource Output Section */}
          <div>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Resource Output
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center p-3 bg-green-50 rounded-lg border">
                <Wheat className="h-5 w-5 text-green-600 mb-1" />
                <div className="text-lg font-semibold text-green-700">{city.food}</div>
                <div className="text-xs text-green-600">Food</div>
              </div>
              <div className="flex flex-col items-center p-3 bg-blue-50 rounded-lg border">
                <Shield className="h-5 w-5 text-blue-600 mb-1" />
                <div className="text-lg font-semibold text-blue-700">{city.shields}</div>
                <div className="text-xs text-blue-600">Shields</div>
              </div>
              <div className="flex flex-col items-center p-3 bg-yellow-50 rounded-lg border">
                <TrendingUp className="h-5 w-5 text-yellow-600 mb-1" />
                <div className="text-lg font-semibold text-yellow-700">{city.trade}</div>
                <div className="text-xs text-yellow-600">Trade</div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Production Section */}
          {city.production && (
            <>
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Hammer className="h-4 w-4" />
                  Current Production
                </h3>
                <div className="p-3 bg-gray-50 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{city.production.target}</span>
                    <Badge variant="secondary" className="capitalize">
                      {city.production.type}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Progress:</span>
                      <span>
                        {city.production.progress} / {city.production.cost}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            (city.production.progress / city.production.cost) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {Math.max(
                        0,
                        Math.ceil(
                          (city.production.cost - city.production.progress) /
                            Math.max(1, city.shields)
                        )
                      )}{' '}
                      turns remaining
                    </div>
                  </div>
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Buildings Section */}
          {city.buildings.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Buildings ({city.buildings.length})
              </h3>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {city.buildings.map((building, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded border"
                  >
                    <span className="text-sm">{building}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
