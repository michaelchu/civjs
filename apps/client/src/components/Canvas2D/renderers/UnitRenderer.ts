/**
 * @module client/components/Canvas2D/renderers/UnitRenderer
 * Implements the Unit Renderer canvas rendering stage.
 */
import type { Unit, MapViewport, Tile } from '../../../types';
import type { GraphicDefinition, UnitOverlayOffsets } from '../../../services/RulesetService';
import { BaseRenderer, type RenderState, type TileRenderDecorator } from './BaseRenderer';
import { sortMapPointsInPainterOrder } from '../mapTopologyGeometry';
import type { TilesetGeometry } from '../tilesets/TilesetProvider';

export interface UnitRenderEntry {
  state: RenderState;
  tile: Tile;
}

interface PreparedUnitLayer {
  unitsAtPosition: Map<string, Unit[]>;
  cityPositions: Set<string>;
  focusedIds: string[];
  focusedAtPosition: Map<string, Unit>;
}

export class UnitRenderer extends BaseRenderer {
  private readonly defaultUnitOverlayOffsets: UnitOverlayOffsets = {
    unitX: 19,
    unitY: -14,
    shieldX: 25,
    shieldY: -16,
    veteranX: 35,
    veteranY: -35,
    stackX: 0,
    stackY: -31,
    stackRingX: 0,
    stackRingY: -31,
    stackRingKey: 'unit.stack',
    shieldRight: false,
    shieldYAligned: false,
  };
  private unitGraphics: Record<string, GraphicDefinition> = {};
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
      segments: Array<{
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
        /** Freeciv-web's destination tuple counter (ANIM_STEPS = 8). */
        remainingSteps: number;
      }>;
      startedAt: number;
    }
  >();
  private readonly movementDurationMs = 180;
  private readonly referenceMovementSteps = 8;
  private squareAnimationSamples = new Map<
    string,
    {
      body: { x: number; y: number };
      shield: { x: number; y: number };
      hp: { x: number; y: number };
    }
  >();
  private indexedUnitsSource: RenderState['units'] | null = null;
  private unitsAtPosition = new Map<string, Unit[]>();
  private indexedCitiesSource: RenderState['cities'] | null = null;
  private cityPositions = new Set<string>();
  private animationUnitsSource: RenderState['units'] | null = null;
  private animationReducedMotion = false;

  /**
   * Render all units visible in the viewport with proper stacking behavior.
   * Only renders the first unit on each tile (freeciv-web stacking behavior).
   */
  renderUnits(state: RenderState, visibleTiles?: Tile[]): void {
    this.updateMovementAnimations(state);
    this.squareAnimationSamples.clear();
    const prepared = this.prepareUnitLayer(state);
    const orderedTiles =
      visibleTiles ??
      sortMapPointsInPainterOrder(Object.values(state.map.tiles), state.map.topology_id ?? 0);

    for (const tile of orderedTiles) {
      if (!tile.known || !this.isInViewport(tile.x, tile.y, state.viewport)) continue;
      const units = prepared.unitsAtPosition.get(`${tile.x},${tile.y}`) ?? [];
      const topUnit = this.selectDrawableUnit(
        units,
        state,
        prepared.cityPositions.has(`${tile.x},${tile.y}`)
      );
      if (topUnit) {
        this.renderUnit(topUnit, state.viewport, units.length, state);
      }
    }
  }

  /**
   * Paint the complete UNIT layer for one tile. This preserves Freeciv's
   * selection-then-unit ordering when MapRenderer merges wrapped copies into
   * one global painter walk.
   */
  renderUnitLayerForTile(state: RenderState, tile: Tile): void {
    this.renderUnitLayerEntries([{ state, tile }]);
  }

  /**
   * Paint one globally ordered UNIT-layer walk. Unit/city indexes and movement
   * state are prepared once per frame, while selection, unit sprites, and
   * effects remain adjacent for each tile exactly as fill_sprite_array().
   */
  renderUnitLayerEntries(
    entries: readonly UnitRenderEntry[],
    afterTile?: (state: RenderState, tile: Tile) => void,
    decorateTile?: TileRenderDecorator
  ): void {
    this.renderUnitLayerEntriesByFocus(entries, 'all', afterTile, decorateTile);
  }

  /** Paint UNIT while reserving the focused unit for Freeciv's later FOCUSUNIT layer. */
  renderNonFocusedUnitLayerEntries(
    entries: readonly UnitRenderEntry[],
    afterTile?: (state: RenderState, tile: Tile) => void,
    decorateTile?: TileRenderDecorator
  ): void {
    this.renderUnitLayerEntriesByFocus(entries, 'non-focused', afterTile, decorateTile);
  }

  /** Paint selection plus the focused unit at Freeciv's late FOCUSUNIT layer. */
  renderFocusedUnitLayerEntries(
    entries: readonly UnitRenderEntry[],
    decorateTile?: TileRenderDecorator
  ): void {
    this.renderUnitLayerEntriesByFocus(entries, 'focused', undefined, decorateTile);
  }

  private renderUnitLayerEntriesByFocus(
    entries: readonly UnitRenderEntry[],
    mode: 'all' | 'non-focused' | 'focused',
    afterTile?: (state: RenderState, tile: Tile) => void,
    decorateTile?: TileRenderDecorator
  ): void {
    const first = entries[0];
    if (!first) return;

    this.updateMovementAnimations(first.state);
    this.squareAnimationSamples.clear();
    const prepared = this.prepareUnitLayer(first.state);
    if (prepared.focusedIds.length === 0) this.resetSelectionAnimation();

    for (const { state, tile } of entries) {
      const renderTile = () => {
        if (!tile.known || !this.isInViewport(tile.x, tile.y, state.viewport)) {
          afterTile?.(state, tile);
          return;
        }

        const key = `${tile.x},${tile.y}`;
        const focused = prepared.focusedAtPosition.get(key);
        if (focused && mode !== 'non-focused') {
          this.renderUnitSelectionOutline(
            focused,
            state.viewport,
            focused.id === prepared.focusedIds[0],
            state.reducedMotion
          );
        }

        const units = prepared.unitsAtPosition.get(key) ?? [];
        const topUnit = this.selectDrawableUnit(units, state, prepared.cityPositions.has(key));
        const topIsFocused = Boolean(topUnit && prepared.focusedIds.includes(topUnit.id));
        const shouldDraw =
          mode === 'all' ||
          (mode === 'focused' && topIsFocused) ||
          (mode === 'non-focused' && !topIsFocused);
        if (topUnit && shouldDraw) this.renderUnit(topUnit, state.viewport, units.length, state);
        afterTile?.(state, tile);
      };
      if (decorateTile) decorateTile(state, tile, renderTile);
      else renderTile();
    }
  }

  private prepareUnitLayer(state: RenderState): PreparedUnitLayer {
    if (this.indexedUnitsSource !== state.units) {
      this.indexedUnitsSource = state.units;
      this.unitsAtPosition = new Map();
      for (const unit of Object.values(state.units)) {
        const key = `${unit.x},${unit.y}`;
        const units = this.unitsAtPosition.get(key) ?? [];
        units.push(unit);
        this.unitsAtPosition.set(key, units);
      }
    }
    if (this.indexedCitiesSource !== state.cities) {
      this.indexedCitiesSource = state.cities;
      this.cityPositions = new Set(Object.values(state.cities).map(city => `${city.x},${city.y}`));
    }

    const focusedIds = state.focusedUnits?.length
      ? state.focusedUnits
      : state.selectedUnitId
        ? [state.selectedUnitId]
        : [];
    const focusedAtPosition = new Map<string, Unit>();
    for (const id of focusedIds) {
      const unit = state.units[id];
      if (unit && !focusedAtPosition.has(`${unit.x},${unit.y}`)) {
        focusedAtPosition.set(`${unit.x},${unit.y}`, unit);
      }
    }

    return {
      unitsAtPosition: this.unitsAtPosition,
      cityPositions: this.cityPositions,
      focusedIds,
      focusedAtPosition,
    };
  }

  private updateMovementAnimations(state: RenderState): void {
    const reducedMotion = Boolean(state.reducedMotion);
    if (
      this.animationUnitsSource === state.units &&
      this.animationReducedMotion === reducedMotion
    ) {
      return;
    }
    this.animationUnitsSource = state.units;
    this.animationReducedMotion = reducedMotion;

    const now = performance.now();
    const activeIds = new Set(Object.keys(state.units));
    if (reducedMotion) {
      this.movementAnimations.clear();
    }
    for (const unit of Object.values(state.units)) {
      const previous = this.lastPositions.get(unit.id);
      const wasTransported = this.lastTransportedState.get(unit.id) ?? false;
      const isTransported = Boolean(unit.transportedBy);
      if (isTransported || wasTransported) {
        this.movementAnimations.delete(unit.id);
      } else if (
        !state.reducedMotion &&
        previous &&
        (previous.x !== unit.x || previous.y !== unit.y)
      ) {
        const current = this.movementAnimations.get(unit.id);
        const segments = current
          ? [
              ...current.segments,
              {
                fromX: current.segments.at(-1)?.toX ?? previous.x,
                fromY: current.segments.at(-1)?.toY ?? previous.y,
                toX: unit.x,
                toY: unit.y,
                remainingSteps: this.referenceMovementSteps,
              },
            ]
          : [
              {
                fromX: previous.x,
                fromY: previous.y,
                toX: unit.x,
                toY: unit.y,
                remainingSteps: this.referenceMovementSteps,
              },
            ];
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
  }

  /** Mirror freeciv-web's find_visible_unit() precedence. */
  private selectDrawableUnit(units: Unit[], state: RenderState, tileHasCity: boolean): Unit | null {
    if (units.length === 0) return null;

    const focusedIds = state.focusedUnits?.length
      ? state.focusedUnits
      : state.selectedUnitId
        ? [state.selectedUnitId]
        : [];
    const focused = focusedIds.map(id => state.units[id]).find(unit => units.includes(unit));
    if (focused) return focused;
    if (tileHasCity) return null;

    return (
      units.find(unit => this.movementAnimations.has(unit.id)) ??
      units.find(unit => !unit.transportedBy) ??
      units[0]
    );
  }

  /**
   * Render unit selection outline.
   */
  renderUnitSelection(state: RenderState, visibleTiles?: Tile[]): void {
    this.updateMovementAnimations(state);
    const { focusedIds, focusedAtPosition } = this.prepareUnitLayer(state);
    if (focusedIds.length === 0) {
      // Reset animation state when no unit is selected
      this.resetSelectionAnimation();
      return;
    }

    const orderedTiles =
      visibleTiles ??
      sortMapPointsInPainterOrder(Object.values(state.map.tiles), state.map.topology_id ?? 0);
    for (const tile of orderedTiles) {
      const unit = focusedAtPosition.get(`${tile.x},${tile.y}`);
      if (unit && tile.known && this.isInViewport(unit.x, unit.y, state.viewport)) {
        this.renderUnitSelectionOutline(
          unit,
          state.viewport,
          unit.id === focusedIds[0],
          state.reducedMotion
        );
      }
    }
  }

  private renderUnit(
    unit: Unit,
    viewport: MapViewport,
    stackSize: number,
    state: RenderState
  ): void {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);
    const offsets = this.getUnitOverlayOffsets();
    const nativeHex = this.getTilesetGeometry().hexWidth > 0;
    // The pinned browser samples its mutable animation tuple for body/activity,
    // nation shield, then HP. A foreign Flagless unit omits the shield helper
    // entirely, so that special case consumes only the body and HP samples.
    // Stack and veteran markers remain at the authoritative tile origin.
    const samplesSquareShield = !(
      this.unitGraphics[unit.unitTypeId]?.flagless &&
      state.currentPlayerId &&
      unit.playerId !== state.currentPlayerId
    );
    const squareSamples = nativeHex
      ? null
      : this.getSquareAnimationSamples(
          unit,
          viewport,
          state.reducedMotion,
          Boolean(samplesSquareShield)
        );
    const bodyAnimOffset =
      squareSamples?.body ?? this.getUnitAnimOffset(unit, viewport, state.reducedMotion);
    const shieldAnimOffset = squareSamples?.shield ?? bodyAnimOffset;
    const hpAnimOffset = squareSamples?.hp ?? bodyAnimOffset;
    const bodyOrigin = {
      x: screenPos.x + bodyAnimOffset.x,
      y: screenPos.y + bodyAnimOffset.y,
    };
    const staticOrigin = screenPos;
    const unitX = bodyOrigin.x + offsets.unitX;
    const unitY = bodyOrigin.y + offsets.unitY;

    // Render unit sprites using freeciv-web approach
    // @reference reference/freeciv-web/.../tilespec.js:fill_unit_sprite_array()
    const nationShield = this.getUnitNationFlagSprite(
      unit,
      state.players[unit.playerId],
      state.currentPlayerId,
      offsets,
      {
        x: shieldAnimOffset.x - bodyAnimOffset.x,
        y: shieldAnimOffset.y - bodyAnimOffset.y,
      }
    );
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

          this.ctx.drawImage(sprite, bodyOrigin.x + offsetX, bodyOrigin.y + offsetY);
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
        bodyOrigin.x + nationShield.offset_x,
        bodyOrigin.y + nationShield.offset_y,
        state.players[unit.playerId]?.color
      );
    }

    if (nativeHex) {
      if (bodyAnimOffset.x === 0 && bodyAnimOffset.y === 0) {
        this.renderNativeUnitIndicators(unit, stackSize, bodyOrigin.x, bodyOrigin.y, offsets);
      }
    } else {
      this.renderLegacyUnitIndicators(
        unit,
        stackSize,
        staticOrigin.x,
        staticOrigin.y,
        offsets,
        hpAnimOffset
      );
    }
  }

  private getSquareAnimationSamples(
    unit: Unit,
    viewport: MapViewport,
    reducedMotion = false,
    sampleShield = true
  ): {
    body: { x: number; y: number };
    shield: { x: number; y: number };
    hp: { x: number; y: number };
  } {
    // A wrapped logical tile can be painted through multiple translated GUI
    // viewports in one map redraw. freeciv-web calls fill_unit_sprite_array()
    // for every copy, so each copy consumes its own body/shield/HP samples.
    const paintedCopyKey = `${unit.id}@${viewport.x},${viewport.y}`;
    const cached = this.squareAnimationSamples.get(paintedCopyKey);
    if (cached) return cached;
    const body = this.getUnitAnimOffset(unit, viewport, reducedMotion);
    const shield = sampleShield ? this.getUnitAnimOffset(unit, viewport, reducedMotion) : body;
    const samples = {
      body,
      shield,
      hp: this.getUnitAnimOffset(unit, viewport, reducedMotion),
    };
    this.squareAnimationSamples.set(paintedCopyKey, samples);
    return samples;
  }

  /**
   * Get unit animation offset for smooth movement
   * @reference reference/freeciv-web/.../unit.js:get_unit_anim_offset()
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
    if (this.getTilesetGeometry().hexWidth <= 0) {
      const segment = animation.segments[0];
      if (!segment) {
        this.movementAnimations.delete(unit.id);
        return { x: 0, y: 0 };
      }
      segment.remainingSteps -= 1;
      const step = Math.floor((segment.remainingSteps + 2) / 3);
      const from = this.mapToScreen(segment.fromX, segment.fromY, viewport);
      const to = this.mapToScreen(segment.toX, segment.toY, viewport);
      const authoritative = this.mapToScreen(unit.x, unit.y, viewport);
      const guiDx =
        Math.floor((to.x - from.x) * (step / this.referenceMovementSteps)) +
        (authoritative.x - to.x);
      const guiDy =
        Math.floor((to.y - from.y) * (step / this.referenceMovementSteps)) +
        (authoritative.y - to.y);
      if (step === 0) {
        animation.segments.shift();
        if (animation.segments.length === 0) this.movementAnimations.delete(unit.id);
      }
      return { x: -guiDx, y: -guiDy };
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
   * @reference reference/freeciv-web/.../tilespec.js:fill_unit_sprite_array()
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

    if (unit.transportedBy && this.getTilesetGeometry().hexWidth > 0) {
      const full = this.getFullTileOffset();
      sprites.push({
        key: 'unit.loaded',
        offset_x: full.x,
        offset_y: full.y,
      });
    }

    // Get activity sprite if unit has activity
    // @reference freeciv-web: get_unit_activity_sprite(punit)
    const activitySprite = this.getUnitActivitySprite(unit);
    if (activitySprite) sprites.push(activitySprite);

    // Freeciv-web paints server-side-agent state separately from activity.
    // This matters for workers that are actively improving a tile and for
    // auto-explore, whose activity sprite is deliberately suppressed.
    const agentSprite = this.getUnitAgentSprite(unit);
    if (agentSprite) sprites.push(agentSprite);

    const orders = Array.isArray(unit.orders) ? unit.orders : [];
    const nativeHex = this.getTilesetGeometry().hexWidth > 0;
    if (nativeHex && orders.length > 0) {
      const repeated = orders.some(
        order =>
          Boolean((order as { repeat?: unknown }).repeat) ||
          String((order as { type?: unknown }).type ?? '')
            .toLowerCase()
            .includes('patrol')
      );
      if (repeated) {
        const full = this.getFullTileOffset();
        sprites.push({ key: 'unit.patrol', offset_x: full.x, offset_y: full.y });
      } else if (
        this.getUnitActivityName(unit) !== '' &&
        this.getUnitActivityName(unit) !== 'idle'
      ) {
        sprites.push({ key: 'unit.connect' });
      } else {
        const activity = this.getActivityOffset();
        sprites.push({ key: 'unit.goto', offset_x: activity.x, offset_y: activity.y });
      }
    }

    if (actionDecisionWant) {
      const activity = this.getActivityOffset();
      sprites.push({
        key: 'unit.action_decision_want',
        offset_x: activity.x,
        offset_y: activity.y,
      });
    }

    if (this.getTilesetGeometry().hexWidth > 0) {
      const full = this.getFullTileOffset();
      const singleMove = 6;
      if ((unit.maxFuel ?? 0) > 0 && unit.fuel === 1 && unit.movesLeft <= 2 * singleMove) {
        sprites.push({ key: 'unit.lowfuel', offset_x: full.x, offset_y: full.y });
      }
      if ((unit.maxMoves ?? 0) > 0 && unit.movesLeft < singleMove) {
        sprites.push({ key: 'unit.tired', offset_x: full.x, offset_y: full.y });
      }
    }

    return sprites;
  }

  private renderLegacyUnitIndicators(
    unit: Unit,
    stackSize: number,
    originX: number,
    originY: number,
    offsets: UnitOverlayOffsets,
    hpAnimOffset: { x: number; y: number }
  ): void {
    const maxHp = Math.max(1, unit.maxHp ?? 100);
    const hpPercent = this.toTenPercentFloor((unit.hp / maxHp) * 100);
    const drewHp = this.drawUnitSpriteIfPresent(
      `unit.hp_${hpPercent}`,
      originX + offsets.stackX + hpAnimOffset.x,
      originY + offsets.stackY + hpAnimOffset.y
    );
    if (!drewHp) {
      this.renderUnitHealthBar(unit, originX + hpAnimOffset.x, originY + hpAnimOffset.y);
    }

    if (stackSize > 1) {
      this.drawUnitSpriteIfPresent(
        offsets.stackRingKey,
        originX + offsets.stackRingX,
        originY + offsets.stackRingY
      );
    }
    this.renderVeteranSprite(unit, originX, originY, offsets);
  }

  private renderNativeUnitIndicators(
    unit: Unit,
    stackSize: number,
    originX: number,
    originY: number,
    offsets: UnitOverlayOffsets
  ): void {
    if (stackSize === 1 && unit.occupied) {
      this.drawUnitSpriteIfPresent(
        offsets.stackRingKey,
        originX + offsets.stackRingX,
        originY + offsets.stackRingY
      );
    } else if (stackSize > 1) {
      const stackNumber = `unit.stack${Math.min(stackSize, 9)}`;
      const previousFilter = this.ctx.filter;
      this.ctx.filter = 'none';
      const drewNumber = this.drawUnitSpriteIfPresent(
        stackNumber,
        originX + offsets.stackX,
        originY + offsets.stackY
      );
      this.ctx.filter = previousFilter;
      if (!drewNumber) {
        this.drawUnitSpriteIfPresent(
          offsets.stackRingKey,
          originX + offsets.stackRingX,
          originY + offsets.stackRingY
        );
      }
    }

    this.renderVeteranSprite(unit, originX, originY, offsets);
    const maxHp = Math.max(1, unit.maxHp ?? 100);
    const hpIndex = Math.max(0, Math.min(10, Math.floor((10 * unit.hp) / maxHp)));
    if (
      !this.drawUnitSpriteIfPresent(
        `unit.hp_${hpIndex * 10}`,
        originX + this.getFullTileOffset().x,
        originY + this.getFullTileOffset().y
      )
    ) {
      this.renderUnitHealthBar(unit, originX, originY);
    }
  }

  private renderVeteranSprite(
    unit: Unit,
    originX: number,
    originY: number,
    offsets: UnitOverlayOffsets
  ): void {
    if (unit.veteranLevel <= 0) return;
    this.drawUnitSpriteIfPresent(
      `unit.vet_${Math.min(unit.veteranLevel, 9)}`,
      originX + offsets.veteranX,
      originY + offsets.veteranY
    );
  }

  private drawUnitSpriteIfPresent(key: string, x: number, y: number): boolean {
    const sprite = this.tilesetLoader.getSprite(key);
    if (!sprite) return false;
    this.ctx.drawImage(sprite, x, y);
    return true;
  }

  private toTenPercentFloor(percent: number): number {
    return Math.max(0, Math.min(100, Math.floor(percent / 10) * 10));
  }

  /**
   * Get unit nation flag sprite
   * @reference freeciv-web: get_unit_nation_flag_sprite()
   */
  private getUnitNationFlagSprite(
    unit: Unit,
    player: RenderState['players'][string] | undefined,
    currentPlayerId: string | undefined,
    offsets: UnitOverlayOffsets,
    animationOffset: { x: number; y: number } = { x: 0, y: 0 }
  ): { key: string; offset_x: number; offset_y: number; fallback?: boolean } | null {
    const definition = this.unitGraphics[unit.unitTypeId];
    if (definition?.flagless && currentPlayerId && unit.playerId !== currentPlayerId) {
      return null;
    }

    // A visible unit can arrive before its PLAYER_INFO packet. Keep an
    // intentional neutral identity cue in that interval rather than making
    // the flag appear intermittently based on packet order.
    if (!player?.nation) {
      return {
        key: '',
        fallback: true,
        offset_x: offsets.shieldX + animationOffset.x,
        offset_y: offsets.shieldY + animationOffset.y,
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
        offset_x: offsets.shieldX + animationOffset.x,
        offset_y: offsets.shieldY + animationOffset.y,
      };
    }

    return {
      key,
      offset_x: offsets.shieldX + animationOffset.x,
      offset_y: offsets.shieldY + animationOffset.y,
    };
  }

  private getUnitOverlayOffsets(): UnitOverlayOffsets {
    const presentation = this.tilesetLoader.getPresentationOffsets();
    const full = this.getFullTileOffset();
    if (this.getTilesetGeometry().hexWidth <= 0) {
      return {
        ...this.defaultUnitOverlayOffsets,
        unitX: full.x + presentation.unitX,
        unitY: full.y + presentation.unitY,
        shieldX: full.x + presentation.unitFlagX,
        shieldY: full.y + presentation.unitFlagY,
        stackX: full.x + presentation.stackX,
        stackY: full.y + presentation.stackY,
        stackRingX: full.x + presentation.stackX,
        stackRingY: full.y + presentation.stackY,
        stackRingKey: 'unit.stack',
      };
    }

    return {
      unitX: full.x + presentation.unitX,
      unitY: full.y + presentation.unitY,
      shieldX: full.x + presentation.unitFlagX,
      shieldY: full.y + presentation.unitFlagY,
      veteranX: full.x,
      veteranY: full.y,
      stackX: presentation.stackX,
      stackY: presentation.stackY,
      stackRingX: full.x,
      stackRingY: full.y,
      stackRingKey: 'unit.stack',
      shieldRight: false,
      shieldYAligned: false,
    };
  }

  private getFullTileOffset(): { x: number; y: number } {
    const geometry = this.getTilesetGeometry();
    return {
      x: (geometry.tileWidth - geometry.fullTileWidth) / 2,
      y: geometry.tileHeight - geometry.fullTileHeight,
    };
  }

  private getActivityOffset(): { x: number; y: number } {
    const offsets = this.tilesetLoader.getPresentationOffsets();
    const full = this.getFullTileOffset();
    return { x: full.x + offsets.activityX, y: full.y + offsets.activityY };
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
    // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tileset_spec_amplio2.js
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

  setUnitGraphics(graphics: Record<string, GraphicDefinition>): void {
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
  ): { key: string; offset_x?: number; offset_y?: number } | null {
    // The reference cannot compose an activity sprite with SSA_AUTOEXPLORE;
    // the agent icon below is the sole overlay in that state.
    if (unit.automation === 'explore') return null;

    const activity = this.getUnitActivityName(unit);
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
      cultivating: 'unit.cultivate',
      cultivate: 'unit.cultivate',
      planting: 'unit.plant',
      transforming: 'unit.transform',
      pillage: 'unit.pillage',
      pillaging: 'unit.pillage',
      pollution: 'unit.pollution',
      cleaning_pollution: 'unit.pollution',
      fallout: 'unit.fallout',
    };
    const targetGraphic = this.getActivityTargetGraphic(unit.activityTarget);
    const key = unit.fortified
      ? 'unit.fortified'
      : activity === 'road' || activity === 'build_road' || activity === 'building_road'
        ? (targetGraphic ?? activitySprites[activity])
        : activity === 'irrigate' || activity === 'irrigation' || activity === 'irrigating'
          ? ((unit.activityTarget && unit.activityTarget !== '-1' ? targetGraphic : undefined) ??
            activitySprites[activity])
          : activity === 'mine' || activity === 'mining'
            ? unit.activityTarget && unit.activityTarget !== '-1'
              ? targetGraphic
              : 'unit.plant'
            : activity === 'base' || activity === 'building_base'
              ? (targetGraphic ?? activitySprites[activity])
              : activitySprites[activity];
    if (!key) return null;

    const activityOffset = this.getActivityOffset();
    return {
      key,
      offset_x: activityOffset.x,
      offset_y: activityOffset.y,
    };
  }

  private getUnitActivityName(unit: Unit): string {
    return typeof unit.activity === 'string'
      ? unit.activity.toLowerCase()
      : unit.activity && typeof unit.activity === 'object' && 'type' in unit.activity
        ? String((unit.activity as { type?: unknown }).type ?? '').toLowerCase()
        : '';
  }

  /**
   * Get the server-side-agent overlay independently of unit activity.
   * @reference freeciv-web: get_unit_agent_sprite()
   */
  private getUnitAgentSprite(
    unit: Unit
  ): { key: string; offset_x: number; offset_y: number } | null {
    if (unit.automation === 'explore') {
      const activityOffset = this.getActivityOffset();
      return {
        key: 'unit.auto_explore',
        offset_x: activityOffset.x,
        offset_y: activityOffset.y,
      };
    }
    if (unit.automation !== 'worker') return null;

    if (
      this.getTilesetGeometry().hexWidth <= 0 ||
      this.tilesetLoader.getSprite('unit.auto_worker')
    ) {
      const full = this.getFullTileOffset();
      return { key: 'unit.auto_worker', offset_x: full.x, offset_y: full.y };
    }

    // Legacy Amplio2 compatibility only. Hexemplio carries unit.auto_worker.
    return { key: 'unit.auto_settler', offset_x: 20, offset_y: this.getActivityOffset().y };
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
    // Freeciv-web emits selection before fill_unit_sprite_array(), so the
    // selection frame is static and does not consume or inherit unit movement.
    if (this.getTilesetGeometry().hexWidth > 0) {
      const movementOffset = this.getUnitAnimOffset(unit, viewport, reducedMotion);
      screenPos.x += movementOffset.x;
      screenPos.y += movementOffset.y;
    }

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
    // Freeciv-web selects one of the four atlas frames from wall-clock time at
    // exactly six frames per second. Keeping this absolute (rather than tied
    // to selection start) also keeps multiple clients on the same cadence.
    const selectionFrame = reducedMotion ? 0 : Math.floor((Date.now() * 6) / 1000) % 4;
    const geometry = this.getTilesetGeometry();
    const selectionKey =
      geometry.hexWidth > 0 ? `unit.select:${selectionFrame}` : `unit.select${selectionFrame}`;
    const selectionSprite = this.tilesetLoader.getSprite(selectionKey);
    if (selectionSprite) {
      const offsets = this.tilesetLoader.getPresentationOffsets();
      this.ctx.drawImage(
        selectionSprite,
        screenPos.x + (geometry.hexWidth > 0 ? offsets.selectX : 0),
        screenPos.y + (geometry.hexWidth > 0 ? offsets.selectY : 0)
      );
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

  /** Keep lightweight renderer test doubles on the legacy geometry path. */
  private getTilesetGeometry(): TilesetGeometry {
    return (
      this.tilesetLoader.getGeometry?.() ?? {
        tileWidth: this.tileWidth,
        tileHeight: this.tileHeight,
        fullTileWidth: this.tileWidth,
        fullTileHeight: this.tileHeight,
        hexWidth: 0,
        hexHeight: 0,
      }
    );
  }
}
