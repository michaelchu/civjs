import * as Phaser from 'phaser';
import { TerrainService, TerrainType } from './TerrainService';
import { IsometricUtils } from './IsometricUtils';

export class MapRenderer {
  private scene: Phaser.Scene;
  private isometricUtils: IsometricUtils;

  constructor(scene: Phaser.Scene, isometricUtils: IsometricUtils) {
    this.scene = scene;
    this.isometricUtils = isometricUtils;
  }

  renderTerrain(
    terrainMap: TerrainType[][],
    mapWidth: number,
    mapHeight: number,
    mapContainer: Phaser.GameObjects.Container
  ): Phaser.GameObjects.Polygon[] {
    const tiles: Phaser.GameObjects.Polygon[] = [];
    const tilePoints = this.isometricUtils.getTilePoints();

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const screenPos = this.isometricUtils.isometricToScreen(x, y);
        const terrainType = terrainMap[y][x];
        const color = TerrainService.getTerrainColor(terrainType);

        const tile = this.scene.add.polygon(
          screenPos.x,
          screenPos.y,
          tilePoints,
          color,
          0.9
        );

        const strokeColor = TerrainService.getTerrainStrokeColor(terrainType);
        tile.setStrokeStyle(1, strokeColor);
        tile.setInteractive(
          new Phaser.Geom.Polygon(tilePoints),
          Phaser.Geom.Polygon.Contains
        );

        tile.setData('tileX', x);
        tile.setData('tileY', y);

        tile.on('pointerover', () => {
          tile.setFillStyle(0xfbbf24, 0.8);
        });

        tile.on('pointerout', () => {
          tile.setFillStyle(color, 0.9);
        });

        tile.setDepth(x + y);
        mapContainer.add(tile);
        tiles.push(tile);
      }
    }

    return tiles;
  }

  highlightTile(
    x: number,
    y: number,
    mapContainer: Phaser.GameObjects.Container
  ) {
    const screenPos = this.isometricUtils.isometricToScreen(x, y);
    const points = this.isometricUtils.getTilePoints();

    const highlight = this.scene.add.polygon(
      screenPos.x,
      screenPos.y,
      points,
      0xfbbf24,
      0.5
    );

    highlight.setStrokeStyle(2, 0xfbbf24);
    highlight.setDepth(x + y + 0.5);
    mapContainer.add(highlight);

    this.scene.tweens.add({
      targets: highlight,
      alpha: 0,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => highlight.destroy(),
    });
  }
}
