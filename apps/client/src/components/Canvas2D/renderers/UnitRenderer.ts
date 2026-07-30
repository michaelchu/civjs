import type { Unit, MapViewport } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';

export class UnitRenderer extends BaseRenderer {
  private unitGraphics: Record<string, { graphic?: string; graphic_alt?: string }> = {};
  // Animation state for unit selection
  private selectionAnimationStartTime: number | null = null;
  private lastSelectedUnitId: string | null = null;
  private lastPositions = new Map<string, { x: number; y: number }>();
  private movementAnimations = new Map<
    string,
    { fromX: number; fromY: number; toX: number; toY: number; startedAt: number }
  >();
  private readonly movementDurationMs = 180;

  /**
   * Render all units visible in the viewport with proper stacking behavior.
   * Only renders the first unit on each tile (freeciv-web stacking behavior).
   */
  renderUnits(state: RenderState): void {
    const now = performance.now();
    const activeIds = new Set(Object.keys(state.units));
    for (const unit of Object.values(state.units)) {
      const previous = this.lastPositions.get(unit.id);
      if (previous && (previous.x !== unit.x || previous.y !== unit.y)) {
        this.movementAnimations.set(unit.id, {
          fromX: previous.x,
          fromY: previous.y,
          toX: unit.x,
          toY: unit.y,
          startedAt: now,
        });
      }
      this.lastPositions.set(unit.id, { x: unit.x, y: unit.y });
    }
    for (const unitId of this.lastPositions.keys()) {
      if (!activeIds.has(unitId)) {
        this.lastPositions.delete(unitId);
        this.movementAnimations.delete(unitId);
      }
    }

    // Group units by position to handle stacking
    const unitsAtPosition = new Map<string, Unit[]>();

    Object.values(state.units).forEach(unit => {
      if (this.isInViewport(unit.x, unit.y, state.viewport)) {
        const posKey = `${unit.x},${unit.y}`;
        if (!unitsAtPosition.has(posKey)) {
          unitsAtPosition.set(posKey, []);
        }
        unitsAtPosition.get(posKey)!.push(unit);
      }
    });

    // Render only the first unit at each position (top of stack)
    unitsAtPosition.forEach(unitsAtPos => {
      if (unitsAtPos.length > 0) {
        // Render the first unit (top of stack)
        const topUnit = unitsAtPos[0];
        this.renderUnit(topUnit, state.viewport, unitsAtPos.length, state);
      }
    });
  }

  /**
   * Render unit selection outline.
   */
  renderUnitSelection(state: RenderState): void {
    // Render all focused units with selection outlines
    const focusedUnits = state.focusedUnits || [];
    if (focusedUnits.length > 0) {
      focusedUnits.forEach((unitId, index) => {
        const unit = state.units[unitId];
        if (unit && this.isInViewport(unit.x, unit.y, state.viewport)) {
          this.renderUnitSelectionOutline(unit, state.viewport, index === 0);
        }
      });
    } else if (state.selectedUnitId) {
      // Fallback to legacy single selection
      const selectedUnit = state.units[state.selectedUnitId];
      if (selectedUnit && this.isInViewport(selectedUnit.x, selectedUnit.y, state.viewport)) {
        this.renderUnitSelectionOutline(selectedUnit, state.viewport, true);
      }
    } else {
      // Reset animation state when no unit is selected
      this.resetSelectionAnimation();
    }
  }

  private renderUnit(
    unit: Unit,
    viewport: MapViewport,
    stackSize: number,
    state: RenderState
  ): void {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);

    // Get unit animation offset for smooth movement
    // @reference freeciv-web/.../unit.js:get_unit_anim_offset()
    const animOffset = this.getUnitAnimOffset(unit, viewport);

    // Apply freeciv-web's unit positioning offsets to properly center units on tiles
    // @reference freeciv-web/tileset_config_amplio2.js: unit_offset_x = 19, unit_offset_y = 14
    // @reference freeciv-web/tilespec.js fill_unit_sprite_array(): "offset_y" : unit_offset['y'] - unit_offset_y
    const UNIT_OFFSET_X = 19;
    const UNIT_OFFSET_Y = 14;
    const unitX = screenPos.x + animOffset.x + UNIT_OFFSET_X;
    const unitY = screenPos.y + animOffset.y - UNIT_OFFSET_Y; // Note: negative Y offset like freeciv-web

    // Render unit sprites using freeciv-web approach
    // @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
    const unitSprites = this.fillUnitSpriteArray(unit, stackSize, state);

    for (const spriteInfo of unitSprites) {
      if (spriteInfo.key) {
        const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
        if (sprite) {
          const offsetX = spriteInfo.offset_x || 0;
          const offsetY = spriteInfo.offset_y || 0;

          this.ctx.drawImage(sprite, unitX + offsetX, unitY + offsetY);
        } else if (spriteInfo.required) {
          // Freeciv tries the ruleset alternate graphic before a local placeholder.
          const alternateGraphic = this.unitGraphics[unit.unitTypeId]?.graphic_alt;
          const fallbackSprite =
            alternateGraphic && alternateGraphic !== '-'
              ? this.tilesetLoader.getSprite(alternateGraphic)
              : null;
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

    this.renderUnitAnnotation(unit, unitX, unitY, stackSize, state);
  }

  /** Render readable labels and attention markers without changing the unit sprite. */
  private renderUnitAnnotation(
    unit: Unit,
    unitX: number,
    unitY: number,
    stackSize: number,
    state: RenderState
  ): void {
    const isOwnUnit = unit.playerId === state.currentPlayerId;
    const isFocused = state.focusedUnits?.includes(unit.id) || state.selectedUnitId === unit.id;
    const isUrgent = state.urgentFocusQueue?.includes(unit.id);

    if (isUrgent) {
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.beginPath();
      this.ctx.arc(unitX + this.tileWidth - 8, unitY + 8, 6, 0, 2 * Math.PI);
      this.ctx.fill();
      this.ctx.fillStyle = '#172033';
      this.ctx.font = 'bold 9px Arial, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('!', unitX + this.tileWidth - 8, unitY + 8);
    }

    if (!isOwnUnit || (!isFocused && !isUrgent)) return;

    const label = unit.unitTypeId.replaceAll('_', ' ');
    this.ctx.font = '600 10px system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    const labelWidth = this.ctx.measureText(label).width + 14;
    const labelX = unitX + this.tileWidth / 2;
    const labelY = unitY - 5;

    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    this.ctx.fillRect(labelX - labelWidth / 2, labelY - 8, labelWidth, 16);
    this.ctx.fillStyle = '#f8fafc';
    this.ctx.fillText(label, labelX, labelY);

    if (stackSize > 1) {
      this.ctx.fillStyle = '#67e8f9';
      this.ctx.font = '600 9px system-ui, sans-serif';
      this.ctx.fillText(`×${stackSize}`, labelX + labelWidth / 2 + 8, labelY);
    }
  }

  /**
   * Get unit animation offset for smooth movement
   * @reference freeciv-web/.../unit.js:get_unit_anim_offset()
   */
  private getUnitAnimOffset(unit: Unit, viewport: MapViewport): { x: number; y: number } {
    const animation = this.movementAnimations.get(unit.id);
    if (!animation) return { x: 0, y: 0 };
    const progress = Math.min(
      1,
      (performance.now() - animation.startedAt) / this.movementDurationMs
    );
    if (progress >= 1) {
      this.movementAnimations.delete(unit.id);
      return { x: 0, y: 0 };
    }
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const from = this.mapToScreen(animation.fromX, animation.fromY, viewport);
    const to = this.mapToScreen(animation.toX, animation.toY, viewport);
    return {
      x: (from.x - to.x) * (1 - easedProgress),
      y: (from.y - to.y) * (1 - easedProgress),
    };
  }

  hasActiveMovementAnimations(): boolean {
    return this.movementAnimations.size > 0;
  }

  /**
   * Fill unit sprite array based on freeciv-web implementation
   * @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
   */
  private fillUnitSpriteArray(
    unit: Unit,
    stackSize: number,
    state: RenderState
  ): Array<{ key: string; offset_x?: number; offset_y?: number; required?: boolean }> {
    const sprites: Array<{
      key: string;
      offset_x?: number;
      offset_y?: number;
      required?: boolean;
    }> = [];

    // Get nation flag sprite
    // @reference freeciv-web: get_unit_nation_flag_sprite(punit)
    const flagSprite = this.getUnitNationFlagSprite(state.players[unit.playerId]?.nation);
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
      required: true,
    });

    // Get activity sprite if unit has activity
    // @reference freeciv-web: get_unit_activity_sprite(punit)
    const activitySprite = this.getUnitActivitySprite(unit);
    if (activitySprite) {
      sprites.push(activitySprite);
    }

    // Add stack indicator if multiple units at same position
    // @reference freeciv-web LAYER_UNIT switch case: handles stackSize display
    if (stackSize > 1) {
      const stackIndicator = Math.min(stackSize, 9); // Max 9 in freeciv-web
      sprites.push({
        key: `unit.stack${stackIndicator}`,
        offset_x: 0,
        offset_y: -31,
      });
    }

    return sprites;
  }

  /**
   * Get unit nation flag sprite
   * @reference freeciv-web: get_unit_nation_flag_sprite()
   */
  private getUnitNationFlagSprite(
    nation: string | undefined
  ): { key: string; offset_x?: number; offset_y?: number } | null {
    if (!nation) return null;
    return {
      key: `f.shield.${nation}`,
      offset_x: 25,
      offset_y: -16,
    };
  }

  /**
   * Get unit type graphic tag
   * @reference freeciv-web: tileset_unit_graphic_tag()
   */
  private getUnitTypeGraphicTag(unitType: string): string {
    const definition = this.unitGraphics[unitType];
    if (definition?.graphic && definition.graphic !== '-') {
      return definition.graphic;
    }
    // Handle special case mappings between common unit type names and sprite names
    // @reference freeciv-web/javascript/2dcanvas/tileset_spec_amplio2.js
    const specialMappings: Record<string, string> = {
      warrior: 'warriors',
      settler: 'settlers',
      scout: 'explorer',
      spearman: 'phalanx',
      horseman: 'horsemen',
      knight: 'knights',
    };

    // Use special mapping if exists, otherwise use direct mapping
    const spriteName = specialMappings[unitType] || unitType;
    return `u.${spriteName}`;
  }

  setUnitGraphics(graphics: Record<string, { graphic?: string; graphic_alt?: string }>): void {
    this.unitGraphics = graphics;
  }

  /**
   * Get unit activity sprite
   * @reference freeciv-web: get_unit_activity_sprite()
   */
  private getUnitActivitySprite(
    unit: Unit
  ): { key: string; offset_x?: number; offset_y?: number } | null {
    const activity = typeof unit.activity === 'string' ? unit.activity.toLowerCase() : '';
    const activitySprites: Record<string, string> = {
      road: 'unit.road',
      build_road: 'unit.road',
      railroad: 'unit.rail',
      build_railroad: 'unit.rail',
      sentry: 'unit.sentry',
      fortify: 'unit.fortifying',
      fortified: 'unit.fortified',
      goto: 'unit.goto',
      explore: 'unit.auto_explore',
      auto_explore: 'unit.auto_explore',
      irrigate: 'unit.irrigate',
      irrigation: 'unit.irrigate',
      mine: 'unit.mine',
      pillage: 'unit.pillage',
      pollution: 'unit.pollution',
      fallout: 'unit.fallout',
    };
    const key = unit.fortified ? 'unit.fortified' : activitySprites[activity];
    return key ? { key, offset_x: 0, offset_y: 0 } : null;
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
  private renderUnitSelectionOutline(
    unit: Unit,
    viewport: MapViewport,
    isPrimary: boolean = true
  ): void {
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

    // Draw the diamond outline with pulsating stroke - different colors for multi-select
    const baseColor = isPrimary ? '255, 255, 0' : '0, 255, 255'; // Yellow for primary, cyan for secondary
    this.ctx.strokeStyle = `rgba(${baseColor}, ${opacity})`;
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
