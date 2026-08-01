import type { Unit, MapViewport } from '../../../types';
import type { GraphicDefinition, UnitOverlayOffsets } from '../../../services/RulesetService';
import { BaseRenderer, type RenderState } from './BaseRenderer';

export class UnitRenderer extends BaseRenderer {
  private readonly unitActivityOffset = { x: 55, y: -25 };
  private readonly defaultUnitOverlayOffsets: UnitOverlayOffsets = {
    unitX: 16,
    unitY: -11,
    shieldX: 25,
    shieldY: -15,
    veteranX: 35,
    veteranY: -35,
    stackX: 0,
    stackY: -31,
    stackRingX: 0,
    stackRingY: -31,
    stackRingKey: 'unit.stk_shld_l',
    shieldRight: false,
    shieldYAligned: false,
  };
  private unitGraphics: Record<
    string,
    { graphic?: string; graphic_alt?: string; offsets?: UnitOverlayOffsets }
  > = {};
  private activityGraphics: Record<string, GraphicDefinition> = {};
  private missingNationShieldDiagnostics = new Set<string>();
  // Animation state for unit selection
  private selectionAnimationStartTime: number | null = null;
  private lastSelectedUnitId: string | null = null;
  private lastPositions = new Map<string, { x: number; y: number }>();
  private lastTransportedState = new Map<string, boolean>();
  private readonly maxMovementAnimations = 30;
  private movementAnimations = new Map<
    string,
    {
      segments: Array<{ fromX: number; fromY: number; toX: number; toY: number }>;
      startedAt: number;
    }
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
      const wasTransported = this.lastTransportedState.get(unit.id) ?? false;
      const isTransported = Boolean(unit.transportedBy);
      if (isTransported || wasTransported) {
        this.movementAnimations.delete(unit.id);
      } else if (previous && (previous.x !== unit.x || previous.y !== unit.y)) {
        const current = this.movementAnimations.get(unit.id);
        const segments = current
          ? [
              ...current.segments,
              {
                fromX: current.segments.at(-1)?.toX ?? previous.x,
                fromY: current.segments.at(-1)?.toY ?? previous.y,
                toX: unit.x,
                toY: unit.y,
              },
            ]
          : [{ fromX: previous.x, fromY: previous.y, toX: unit.x, toY: unit.y }];
        if (current || this.movementAnimations.size < this.maxMovementAnimations) {
          this.movementAnimations.set(unit.id, {
            segments,
            startedAt: current?.startedAt ?? now,
          });
        }
      }
      this.lastPositions.set(unit.id, { x: unit.x, y: unit.y });
      this.lastTransportedState.set(unit.id, isTransported);
    }
    for (const unitId of this.lastPositions.keys()) {
      if (!activeIds.has(unitId)) {
        this.lastPositions.delete(unitId);
        this.lastTransportedState.delete(unitId);
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

  /** Render the selected unit again above map overlays. */
  renderSelectedUnit(state: RenderState): void {
    const selectedUnitId = state.selectedUnitId ?? state.focusedUnits?.[0];
    if (!selectedUnitId) return;

    const selectedUnit = state.units[selectedUnitId];
    if (!selectedUnit || !this.isInViewport(selectedUnit.x, selectedUnit.y, state.viewport)) {
      return;
    }

    const stackSize = Object.values(state.units).filter(
      unit => unit.x === selectedUnit.x && unit.y === selectedUnit.y
    ).length;
    this.renderUnit(selectedUnit, state.viewport, stackSize, state);
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
          this.renderUnitSelectionOutline(unit, state.viewport, index === 0, state.reducedMotion);
        }
      });
    } else if (state.selectedUnitId) {
      // Fallback to legacy single selection
      const selectedUnit = state.units[state.selectedUnitId];
      if (selectedUnit && this.isInViewport(selectedUnit.x, selectedUnit.y, state.viewport)) {
        this.renderUnitSelectionOutline(selectedUnit, state.viewport, true, state.reducedMotion);
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
    const animOffset = this.getUnitAnimOffset(unit, viewport, state.reducedMotion);

    // Sprite offsets are relative to the tile origin, matching the reference
    // fill_unit_sprite_array() contract. Unit-specific UO_* adjustments are
    // supplied by the ruleset presentation endpoint.
    const originX = screenPos.x + animOffset.x;
    const originY = screenPos.y + animOffset.y;
    const offsets = this.getUnitOverlayOffsets(unit);
    const unitX = originX + offsets.unitX;
    const unitY = originY + offsets.unitY;

    // Render unit sprites using freeciv-web approach
    // @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
    const nationShield = this.getUnitNationFlagSprite(state.players[unit.playerId], offsets);
    const unitSprites = this.fillUnitSpriteArray(
      unit,
      nationShield,
      offsets,
      unit.actionDecisionWant || state.actionDecisionUnitId === unit.id
    );

    for (const spriteInfo of unitSprites) {
      if (spriteInfo.key) {
        const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
        if (sprite) {
          const offsetX = spriteInfo.offset_x || 0;
          const offsetY = spriteInfo.offset_y || 0;

          this.ctx.drawImage(sprite, originX + offsetX, originY + offsetY);
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

    if (nationShield?.fallback) {
      this.renderNationShieldFallback(
        originX + nationShield.offset_x,
        originY + nationShield.offset_y,
        state.players[unit.playerId]?.color
      );
    }

    // Reference draws the HP/stack/veteran overlays only while stationary.
    // During movement they remain attached to the authoritative unit sprite
    // and are reintroduced on the next settled frame.
    if (animOffset.x === 0 && animOffset.y === 0) {
      this.renderUnitIndicatorSprites(unit, stackSize, originX, originY, offsets, state);
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
  private getUnitAnimOffset(
    unit: Unit,
    viewport: MapViewport,
    reducedMotion = false
  ): { x: number; y: number } {
    const animation = this.movementAnimations.get(unit.id);
    if (!animation) return { x: 0, y: 0 };
    if (reducedMotion) {
      this.movementAnimations.delete(unit.id);
      return { x: 0, y: 0 };
    }
    const elapsed = performance.now() - animation.startedAt;
    const segmentIndex = Math.floor(elapsed / this.movementDurationMs);
    if (segmentIndex >= animation.segments.length) {
      this.movementAnimations.delete(unit.id);
      return { x: 0, y: 0 };
    }
    const segment = animation.segments[segmentIndex];
    const progress = Math.min(1, (elapsed % this.movementDurationMs) / this.movementDurationMs);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const from = this.mapToScreen(segment.fromX, segment.fromY, viewport);
    const to = this.mapToScreen(segment.toX, segment.toY, viewport);
    const authoritative = this.mapToScreen(unit.x, unit.y, viewport);
    return {
      x: from.x + (to.x - from.x) * easedProgress - authoritative.x,
      y: from.y + (to.y - from.y) * easedProgress - authoritative.y,
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
    nationShield: { key: string; offset_x: number; offset_y: number; fallback?: boolean } | null,
    offsets: UnitOverlayOffsets,
    actionDecisionWant: boolean
  ): Array<{ key: string; offset_x?: number; offset_y?: number; required?: boolean }> {
    const sprites: Array<{
      key: string;
      offset_x?: number;
      offset_y?: number;
      required?: boolean;
    }> = [];

    // Get nation flag sprite
    // @reference freeciv-web: get_unit_nation_flag_sprite(punit)
    if (nationShield && !nationShield.fallback) {
      sprites.push(nationShield);
    }

    // Get main unit graphic
    // @reference freeciv-web: tileset_unit_graphic_tag(punit)
    const unitGraphic = this.getUnitTypeGraphicTag(unit.unitTypeId);
    sprites.push({
      key: unitGraphic,
      offset_x: offsets.unitX,
      offset_y: offsets.unitY,
      required: true,
    });

    // Get activity sprite if unit has activity
    // @reference freeciv-web: get_unit_activity_sprite(punit)
    const activitySprite = this.getUnitActivitySprite(unit);
    if (activitySprite) {
      sprites.push(activitySprite);
      if (activitySprite.connect) {
        sprites.push({ key: 'unit.connect', offset_x: -6, offset_y: -6 });
      }
    }

    if (actionDecisionWant) {
      sprites.push({
        key: 'unit.action_decision_want',
        offset_x: this.unitActivityOffset.x,
        offset_y: this.unitActivityOffset.y,
      });
    }

    if (unit.veteranLevel > 0) {
      sprites.push({
        key: `unit.vet_${Math.min(unit.veteranLevel, 9)}`,
        offset_x: offsets.veteranX,
        offset_y: offsets.veteranY,
      });
    }

    return sprites;
  }

  private renderUnitIndicatorSprites(
    unit: Unit,
    stackSize: number,
    originX: number,
    originY: number,
    offsets: UnitOverlayOffsets,
    state: RenderState
  ): void {
    const maxHp = Math.max(1, unit.maxHp ?? 100);
    const hpPercent = this.toFivePercent((unit.hp / maxHp) * 100);
    const hpKey = `unit.hp_${hpPercent}`;
    const hasMoveBar =
      Boolean(state.showUnitMovePoints) &&
      Number.isFinite(unit.movesLeft) &&
      Number.isFinite(unit.maxMoves) &&
      (unit.maxMoves ?? 0) > 0;
    const movePercent = hasMoveBar
      ? this.toFivePercent((unit.movesLeft / (unit.maxMoves ?? 1)) * 100)
      : hpPercent;

    let drewHp = false;
    if (hasMoveBar) {
      drewHp =
        this.drawUnitSpriteIfPresent(`unit.hp_${movePercent}`, originX, originY - 31) || drewHp;
    }
    drewHp =
      this.drawUnitSpriteIfPresent(hpKey, originX, originY - (hasMoveBar ? 36 : 31)) || drewHp;

    // Keep the generic bar as a ruleset/tileset fallback, including full HP.
    if (!drewHp) this.renderUnitHealthBar(unit, originX, originY);

    if (stackSize > 1) {
      if (!offsets.shieldYAligned) {
        this.drawUnitSpriteIfPresent(
          offsets.stackRingKey,
          originX + offsets.stackRingX,
          originY + offsets.stackRingY
        );
      }
      this.drawUnitSpriteIfPresent(
        `unit.stack${Math.min(stackSize, 9)}`,
        originX + offsets.stackX,
        originY + offsets.stackY
      );
    }
  }

  private drawUnitSpriteIfPresent(key: string, x: number, y: number): boolean {
    const sprite = this.tilesetLoader.getSprite(key);
    if (!sprite) return false;
    this.ctx.drawImage(sprite, x, y);
    return true;
  }

  private toFivePercent(percent: number): number {
    return Math.max(0, Math.min(100, Math.round(percent / 5) * 5));
  }

  /**
   * Get unit nation flag sprite
   * @reference freeciv-web: get_unit_nation_flag_sprite()
   */
  private getUnitNationFlagSprite(
    player: RenderState['players'][string] | undefined,
    offsets: UnitOverlayOffsets
  ): { key: string; offset_x: number; offset_y: number; fallback?: boolean } | null {
    // A visible unit can arrive before its PLAYER_INFO packet. Keep an
    // intentional neutral identity cue in that interval rather than making
    // the flag appear intermittently based on packet order.
    if (!player?.nation) {
      return {
        key: '',
        fallback: true,
        offset_x: offsets.shieldX,
        offset_y: offsets.shieldY,
      };
    }

    const graphicCandidates = [player.nationGraphic, player.nation].filter(
      (graphic): graphic is string => Boolean(graphic)
    );
    const keyCandidates = graphicCandidates.flatMap(graphic => [
      `f.shield.${graphic}`,
      `f.shld_lg.${graphic}`,
    ]);
    const key = keyCandidates.find(candidate => this.tilesetLoader.getSprite(candidate));
    if (!key) {
      const diagnosticKey = `${player.nationGraphic ?? player.nation}`;
      if (!this.missingNationShieldDiagnostics.has(diagnosticKey)) {
        this.missingNationShieldDiagnostics.add(diagnosticKey);
        if (import.meta.env.DEV) {
          console.warn(`Missing nation shield sprite for ${diagnosticKey}`);
        }
      }
      return {
        key: '',
        fallback: true,
        offset_x: offsets.shieldX,
        offset_y: offsets.shieldY,
      };
    }

    return {
      key,
      offset_x: offsets.shieldX,
      offset_y: offsets.shieldY,
    };
  }

  private getUnitOverlayOffsets(unit: Unit): UnitOverlayOffsets {
    return this.unitGraphics[unit.unitTypeId]?.offsets ?? this.defaultUnitOverlayOffsets;
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

  setUnitGraphics(
    graphics: Record<
      string,
      { graphic?: string; graphic_alt?: string; offsets?: UnitOverlayOffsets }
    >
  ): void {
    this.unitGraphics = graphics;
  }

  setActivityGraphics(graphics: Record<string, GraphicDefinition>): void {
    this.activityGraphics = graphics;
  }

  /**
   * Get unit activity sprite
   * @reference freeciv-web: get_unit_activity_sprite()
   */
  private getUnitActivitySprite(
    unit: Unit
  ): { key: string; offset_x?: number; offset_y?: number; connect?: boolean } | null {
    const activity =
      typeof unit.activity === 'string'
        ? unit.activity.toLowerCase()
        : unit.activity && typeof unit.activity === 'object' && 'type' in unit.activity
          ? String((unit.activity as { type?: unknown }).type ?? '').toLowerCase()
          : '';
    const activitySprites: Record<string, string> = {
      road: 'unit.road',
      build_road: 'unit.road',
      building_road: 'unit.road',
      railroad: 'unit.rail',
      build_railroad: 'unit.rail',
      building_railroad: 'unit.rail',
      sentry: 'unit.sentry',
      vigil: 'unit.vigil',
      fortify: 'unit.fortifying',
      fortified: 'unit.fortified',
      fortify_delay: 'unit.fortify_delay',
      building_fortress: 'unit.fortress',
      building_airbase: 'unit.airbase',
      outpost: 'unit.outpost',
      patrolling: 'unit.patrol',
      patrol: 'unit.patrol',
      patrol_back: 'unit.patrol_back',
      goto: 'unit.goto',
      goto_delay: 'unit.goto_delay',
      delayed_goto: 'unit.goto_delay',
      explore: 'unit.auto_explore',
      auto_explore: 'unit.auto_explore',
      auto_settler: 'unit.auto_settler',
      cargo: 'unit.cargo',
      fishing: 'unit.fishing',
      convert: 'unit.convert',
      hidden: 'unit.hidden',
      deepdive: 'unit.deepdive',
      irrigate: 'unit.irrigate',
      irrigation: 'unit.irrigate',
      irrigating: 'unit.irrigate',
      mine: 'unit.mine',
      mining: 'unit.mine',
      cultivating: 'unit.irrigate',
      cultivate: 'unit.irrigate',
      planting: 'unit.plant',
      transforming: 'unit.transform',
      pillage: 'unit.pillage',
      pillaging: 'unit.pillage',
      pollution: 'unit.pollution',
      cleaning_pollution: 'unit.pollution',
      fallout: 'unit.fallout',
    };
    const transportedActivity =
      unit.transportedBy && (!activity || activity === 'idle' || activity === 'sentry');
    const targetGraphic = this.getActivityTargetGraphic(unit.activityTarget);
    const key = transportedActivity
      ? 'unit.cargo'
      : unit.fortified
        ? 'unit.fortified'
        : unit.automation === 'worker' && activity === 'idle'
          ? 'unit.auto_settler'
          : activity === 'road' || activity === 'build_road' || activity === 'building_road'
            ? (targetGraphic ?? activitySprites[activity])
            : activity === 'irrigate' || activity === 'irrigation' || activity === 'irrigating'
              ? ((unit.activityTarget && unit.activityTarget !== '-1'
                  ? targetGraphic
                  : undefined) ?? activitySprites[activity])
              : activity === 'mine' || activity === 'mining'
                ? unit.activityTarget && unit.activityTarget !== '-1'
                  ? targetGraphic
                  : 'unit.plant'
                : activity === 'base' || activity === 'building_base'
                  ? (targetGraphic ?? activitySprites[activity])
                  : activitySprites[activity];
    if (!key) return null;

    const connectingActivities = new Set([
      'road',
      'build_road',
      'building_road',
      'railroad',
      'build_railroad',
      'building_railroad',
      'irrigate',
      'irrigation',
      'irrigating',
      'mine',
      'mining',
      'cultivate',
      'cultivating',
      'planting',
    ]);
    return {
      key,
      offset_x: this.unitActivityOffset.x,
      offset_y: this.unitActivityOffset.y,
      connect:
        connectingActivities.has(activity) && Array.isArray(unit.orders) && unit.orders.length > 0,
    };
  }

  private getActivityTargetGraphic(activityTarget?: string): string | null {
    if (!activityTarget || activityTarget === '-1') return null;
    const normalized = String(activityTarget).trim().toLowerCase();
    const candidates = [normalized, `extra_${normalized}`];
    const match =
      candidates.map(candidate => this.activityGraphics[candidate]).find(Boolean) ??
      Object.values(this.activityGraphics).find(definition => {
        const names = [definition.name, definition.rule_name]
          .filter(Boolean)
          .map(value => value!.trim().toLowerCase());
        return names.includes(normalized);
      });
    if (!match) return null;

    return (
      [match.activity_gfx, match.act_gfx_alt, match.act_gfx_alt2].find(graphic =>
        Boolean(graphic && graphic !== '-' && graphic !== 'None')
      ) ?? null
    );
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

  /** Render a visible identity cue when a ruleset omits a matching atlas flag. */
  private renderNationShieldFallback(x: number, y: number, color = '#64748b'): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, 14, 14);
    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    this.ctx.fillRect(x + 2, y + 2, 10, 10);
    this.ctx.fillStyle = '#f8fafc';
    this.ctx.fillRect(x + 5, y + 5, 4, 4);
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
    if (typeof this.ctx.strokeRect === 'function') {
      this.ctx.strokeRect(barX, barY, barWidth, barHeight);
    }
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
    isPrimary: boolean = true,
    reducedMotion = false
  ): void {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);
    const movementOffset = this.getUnitAnimOffset(unit, viewport, reducedMotion);
    screenPos.x += movementOffset.x;
    screenPos.y += movementOffset.y;

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

    // Prefer the atlas animation used by freeciv-web; retain the procedural
    // diamond below as a fallback for reduced/custom tilesets.
    const selectionFrame = reducedMotion ? 0 : Math.floor(Date.now() / 125) % 4;
    const selectionSprite = this.tilesetLoader.getSprite(`unit.select${selectionFrame}`);
    if (selectionSprite) {
      this.ctx.drawImage(selectionSprite, screenPos.x, screenPos.y);
      return;
    }

    // Create pulsating effect using time-based animation that starts at brightest level
    const currentTime = reducedMotion
      ? (this.selectionAnimationStartTime ?? Date.now())
      : Date.now();
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
