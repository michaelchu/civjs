import type { Unit, MapViewport } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';

export class UnitRenderer extends BaseRenderer {
  // Animation state for unit selection
  private selectionAnimationStartTime: number | null = null;
  private lastSelectedUnitId: string | null = null;

  /**
   * Render all units visible in the viewport.
   */
  renderUnits(state: RenderState): void {
    Object.values(state.units).forEach(unit => {
      if (this.isInViewport(unit.x, unit.y, state.viewport)) {
        this.renderUnit(unit, state.viewport);
      }
    });
  }

  /**
   * Render unit selection outline.
   */
  renderUnitSelection(state: RenderState): void {
    if (state.selectedUnitId) {
      const selectedUnit = state.units[state.selectedUnitId];
      if (selectedUnit && this.isInViewport(selectedUnit.x, selectedUnit.y, state.viewport)) {
        this.renderUnitSelectionOutline(selectedUnit, state.viewport);
      }
    } else {
      // Reset animation state when no unit is selected
      this.resetSelectionAnimation();
    }
  }

  private renderUnit(unit: Unit, viewport: MapViewport): void {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);

    // Get unit animation offset for smooth movement
    // @reference freeciv-web/.../unit.js:get_unit_anim_offset()
    const animOffset = this.getUnitAnimOffset();

    // Apply freeciv-web's unit positioning offsets to properly center units on tiles
    // @reference freeciv-web/tileset_config_amplio2.js: unit_offset_x = 19, unit_offset_y = 14
    // @reference freeciv-web/tilespec.js fill_unit_sprite_array(): "offset_y" : unit_offset['y'] - unit_offset_y
    const UNIT_OFFSET_X = 19;
    const UNIT_OFFSET_Y = 14;
    const unitX = screenPos.x + animOffset.x + UNIT_OFFSET_X;
    const unitY = screenPos.y + animOffset.y - UNIT_OFFSET_Y; // Note: negative Y offset like freeciv-web

    // Render unit sprites using freeciv-web approach
    // @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
    const unitSprites = this.fillUnitSpriteArray(unit);

    for (const spriteInfo of unitSprites) {
      if (spriteInfo.key) {
        const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
        if (sprite) {
          const offsetX = spriteInfo.offset_x || 0;
          const offsetY = spriteInfo.offset_y || 0;

          this.ctx.drawImage(sprite, unitX + offsetX, unitY + offsetY);
        } else {
          // Fallback to unit type specific sprite key
          const fallbackKey = this.getUnitTypeGraphicTag(unit.unitTypeId);
          const fallbackSprite = this.tilesetLoader.getSprite(fallbackKey);
          if (fallbackSprite) {
            this.ctx.drawImage(fallbackSprite, unitX, unitY);
          } else {
            // Final fallback: render placeholder with unit type indication
            this.renderUnitPlaceholder(unit, unitX, unitY);
          }
        }
      }
    }

    // Render health bar if unit is damaged
    if (unit.hp < 100) {
      this.renderUnitHealthBar(unit, unitX, unitY);
    }

    // Render unit status indicators (fortified, etc.)
    this.renderUnitStatusIndicators();
  }

  /**
   * Get unit animation offset for smooth movement
   * @reference freeciv-web/.../unit.js:get_unit_anim_offset()
   */
  private getUnitAnimOffset(): { x: number; y: number } {
    // For now, return no offset (static units)
    // TODO: Implement smooth movement animation system
    return { x: 0, y: 0 };
  }

  /**
   * Fill unit sprite array based on freeciv-web implementation
   * @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
   */
  private fillUnitSpriteArray(
    unit: Unit
  ): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    const sprites: Array<{ key: string; offset_x?: number; offset_y?: number }> = [];

    // Get nation flag sprite
    // @reference freeciv-web: get_unit_nation_flag_sprite(punit)
    const flagSprite = this.getUnitNationFlagSprite();
    if (flagSprite) {
      sprites.push(flagSprite);
    }

    // Get main unit graphic
    // @reference freeciv-web: tileset_unit_graphic_tag(punit)
    const unitGraphic = this.getUnitTypeGraphicTag(unit.unitTypeId);
    sprites.push({
      key: unitGraphic,
      offset_x: 0,
      offset_y: 0,
    });

    // Get activity sprite if unit has activity
    // @reference freeciv-web: get_unit_activity_sprite(punit)
    const activitySprite = this.getUnitActivitySprite();
    if (activitySprite) {
      sprites.push(activitySprite);
    }

    return sprites;
  }

  /**
   * Get unit nation flag sprite
   * @reference freeciv-web: get_unit_nation_flag_sprite()
   */
  private getUnitNationFlagSprite(): { key: string; offset_x?: number; offset_y?: number } | null {
    // For now, return null (no flag rendering)
    // TODO: Implement nation flag sprites based on player nation
    return null;
  }

  /**
   * Get unit type graphic tag
   * @reference freeciv-web: tileset_unit_graphic_tag()
   */
  private getUnitTypeGraphicTag(unitType: string): string {
    // Map unit types to sprite keys based on freeciv tileset naming
    // @reference freeciv/data/amplio2/units.spec - unit sprite definitions
    const unitSpriteMap: Record<string, string> = {
      warrior: 'u.warriors_Idle:0',
      settler: 'u.settlers_Idle:0',
      scout: 'u.explorers_Idle:0',
      worker: 'u.workers_Idle:0',
      archer: 'u.archers_Idle:0',
      spearman: 'u.phalanx_Idle:0',
      // Additional common units
      horseman: 'u.horsemen_Idle:0',
      knight: 'u.knights_Idle:0',
      legion: 'u.legion_Idle:0',
      pikeman: 'u.pikemen_Idle:0',
      musketeers: 'u.musketeers_Idle:0',
      riflemen: 'u.riflemen_Idle:0',
      cavalry: 'u.cavalry_Idle:0',
      cannon: 'u.cannon_Idle:0',
      catapult: 'u.catapult_Idle:0',
      trireme: 'u.trireme_Idle:0',
      caravel: 'u.caravel_Idle:0',
      frigate: 'u.frigate_Idle:0',
      ironclad: 'u.ironclad_Idle:0',
      destroyer: 'u.destroyer_Idle:0',
      cruiser: 'u.cruiser_Idle:0',
      battleship: 'u.battleship_Idle:0',
      submarine: 'u.submarine_Idle:0',
      carrier: 'u.carrier_Idle:0',
    };

    return unitSpriteMap[unitType] || `u.${unitType}_Idle:0`;
  }

  /**
   * Get unit activity sprite
   * @reference freeciv-web: get_unit_activity_sprite()
   */
  private getUnitActivitySprite(): { key: string; offset_x?: number; offset_y?: number } | null {
    // TODO: Implement activity sprites (fortified, sentry, etc.)
    return null;
  }

  /**
   * Render unit placeholder when sprites are not available
   */
  private renderUnitPlaceholder(unit: Unit, x: number, y: number): void {
    // Position placeholder at the corrected unit position (already offset)
    this.ctx.fillStyle = this.getPlayerColor(unit.playerId);
    this.ctx.beginPath();
    this.ctx.arc(x + this.tileWidth / 2, y + this.tileHeight / 2, 8, 0, 2 * Math.PI);
    this.ctx.fill();

    this.ctx.fillStyle = 'white';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      unit.unitTypeId.charAt(0).toUpperCase(),
      x + this.tileWidth / 2,
      y + this.tileHeight / 2 + 4
    );
  }

  /**
   * Render unit health bar
   * @reference freeciv-web health bar rendering
   */
  private renderUnitHealthBar(unit: Unit, x: number, y: number): void {
    const barWidth = 24;
    const barHeight = 4;
    const healthPercent = unit.hp / 100;

    // Position health bar relative to the corrected unit position
    const barX = x + this.tileWidth / 2 - barWidth / 2;
    const barY = y + this.tileHeight - 8;

    // Background (red)
    this.ctx.fillStyle = '#ff0000';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Health (green)
    this.ctx.fillStyle = '#00ff00';
    this.ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

    // Border
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  /**
   * Render unit status indicators (fortified, activity, etc.)
   * @reference freeciv-web status indicator rendering
   */
  private renderUnitStatusIndicators(): void {
    // TODO: Implement status indicators
    // - Fortified indicator
    // - Sentry indicator
    // - Goto indicator
    // - Activity indicators
  }

  /**
   * Reset the selection animation state
   */
  private resetSelectionAnimation(): void {
    this.selectionAnimationStartTime = null;
    this.lastSelectedUnitId = null;
  }

  /**
   * Render pulsating diamond selection outline for selected unit
   * Renders on main canvas between terrain and units for proper layering
   */
  private renderUnitSelectionOutline(unit: Unit, viewport: MapViewport): void {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);

    // Reset animation when unit selection changes
    if (this.lastSelectedUnitId !== unit.id) {
      this.selectionAnimationStartTime = Date.now();
      this.lastSelectedUnitId = unit.id;
      if (import.meta.env.DEV) {
        console.log(
          `Animation reset for unit ${unit.id} at time ${this.selectionAnimationStartTime}`
        );
      }
    }

    // Create pulsating effect using time-based animation that starts at brightest level
    const currentTime = Date.now();
    const elapsedTime = this.selectionAnimationStartTime
      ? currentTime - this.selectionAnimationStartTime
      : 0;
    const time = elapsedTime / 500; // Same speed as original (500ms cycle time)

    // Use cosine for natural start at maximum - but adjust frequency to match original
    // Original: sin(time) where time = Date.now() / 500
    // New: cos(time) where time = elapsedTime / 500 to maintain same period
    const pulse = (Math.cos(time) + 1) / 2; // 0 to 1, starts at 1 (brightest), same speed as original
    const opacity = 0.4 + pulse * 0.6; // 0.4 to 1.0, starts at 1.0
    const lineWidth = 1 + pulse * 2; // 1 to 3, starts at 3

    if (import.meta.env.DEV && elapsedTime < 100) {
      console.log(
        `Unit ${unit.id}: elapsed=${elapsedTime}ms, pulse=${pulse.toFixed(3)}, opacity=${opacity.toFixed(3)}`
      );
    }

    const centerX = screenPos.x + this.tileWidth / 2;
    const centerY = screenPos.y + this.tileHeight / 2;
    const halfWidth = this.tileWidth / 2;
    const halfHeight = this.tileHeight / 2;

    // Draw the diamond outline with pulsating yellow stroke
    this.ctx.strokeStyle = `rgba(255, 255, 0, ${opacity})`;
    this.ctx.lineWidth = lineWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, centerY - halfHeight); // Top
    this.ctx.lineTo(centerX + halfWidth, centerY); // Right
    this.ctx.lineTo(centerX, centerY + halfHeight); // Bottom
    this.ctx.lineTo(centerX - halfWidth, centerY); // Left
    this.ctx.closePath();
    this.ctx.stroke();

    // Add a subtle pulsating fill
    this.ctx.fillStyle = `rgba(255, 255, 0, ${opacity * 0.1})`;
    this.ctx.fill();

    // Add inner diamond for enhanced visibility
    this.ctx.strokeStyle = `rgba(255, 255, 0, ${opacity * 0.7})`;
    this.ctx.lineWidth = 1;
    const innerScale = 0.85;
    const innerHalfWidth = halfWidth * innerScale;
    const innerHalfHeight = halfHeight * innerScale;

    this.ctx.beginPath();
    this.ctx.moveTo(centerX, centerY - innerHalfHeight); // Top
    this.ctx.lineTo(centerX + innerHalfWidth, centerY); // Right
    this.ctx.lineTo(centerX, centerY + innerHalfHeight); // Bottom
    this.ctx.lineTo(centerX - innerHalfWidth, centerY); // Left
    this.ctx.closePath();
    this.ctx.stroke();
  }
}
