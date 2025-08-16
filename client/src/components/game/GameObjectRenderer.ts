import * as Phaser from 'phaser';
import { IsometricUtils } from './IsometricUtils';

export interface Unit {
  id: string;
  x: number;
  y: number;
  type: string;
}

export interface City {
  id: string;
  x: number;
  y: number;
  name: string;
}

export class GameObjectRenderer {
  private scene: Phaser.Scene;
  private isometricUtils: IsometricUtils;
  private unitSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private citySprites: Map<string, Phaser.GameObjects.Sprite> = new Map();

  constructor(scene: Phaser.Scene, isometricUtils: IsometricUtils) {
    this.scene = scene;
    this.isometricUtils = isometricUtils;
  }

  renderUnits(
    units: Unit[],
    mapContainer: Phaser.GameObjects.Container,
    onUnitSelect?: (unitId: string) => void
  ) {
    this.clearUnits();

    units.forEach(unit => {
      const screenPos = this.isometricUtils.isometricToScreen(unit.x, unit.y);
      const unitSprite = this.scene.add.circle(
        screenPos.x,
        screenPos.y - 10,
        15,
        0x3b82f6
      );

      unitSprite.setStrokeStyle(2, 0x1e40af);
      unitSprite.setInteractive();

      if (onUnitSelect) {
        unitSprite.on('pointerdown', () => {
          onUnitSelect(unit.id);
        });
      }

      unitSprite.setDepth(unit.x + unit.y + 1);
      mapContainer.add(unitSprite);
      this.unitSprites.set(unit.id, unitSprite as Phaser.GameObjects.Sprite);
    });
  }

  renderCities(cities: City[], mapContainer: Phaser.GameObjects.Container) {
    this.clearCities();

    cities.forEach(city => {
      const screenPos = this.isometricUtils.isometricToScreen(city.x, city.y);
      const citySprite = this.scene.add.star(
        screenPos.x,
        screenPos.y - 15,
        6,
        12,
        20,
        0xfbbf24
      );

      citySprite.setStrokeStyle(2, 0xf59e0b);
      citySprite.setDepth(city.x + city.y + 1);
      mapContainer.add(citySprite);
      this.citySprites.set(city.id, citySprite as Phaser.GameObjects.Sprite);
    });
  }

  clearUnits() {
    this.unitSprites.forEach(sprite => sprite.destroy());
    this.unitSprites.clear();
  }

  clearCities() {
    this.citySprites.forEach(sprite => sprite.destroy());
    this.citySprites.clear();
  }

  clear() {
    this.clearUnits();
    this.clearCities();
  }

  getUnitSprites(): Map<string, Phaser.GameObjects.Sprite> {
    return this.unitSprites;
  }

  getCitySprites(): Map<string, Phaser.GameObjects.Sprite> {
    return this.citySprites;
  }
}
