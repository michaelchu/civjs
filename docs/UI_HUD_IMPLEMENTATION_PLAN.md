# UI HUD Implementation Plan

## Purpose

Build a persistent, information-dense game HUD inspired by the supplied reference screenshot while keeping the existing CivJS visual style and 2D map renderer.

The target is the interaction model and information hierarchy:

- The map remains visible as the primary surface.
- Important game state is always available in lightweight overlays.
- Selecting a city or unit changes the contextual controls at the bottom.
- Larger reports and management workflows remain available as intentional panels or dialogs.

This is not a plan to reproduce the reference art direction, 3D world, or asset style.

## Current foundation

The existing frontend already provides most of the game-state plumbing needed for this work:

- `apps/client/src/components/GameUI/GameLayout.tsx` — top-level game composition.
- `apps/client/src/components/Canvas2D/MapCanvas.tsx` — persistent map surface and map interaction.
- `apps/client/src/components/GameUI/StatusPanel.tsx` — current top status information.
- `apps/client/src/components/GameUI/TurnDoneButton.tsx` — turn completion action.
- `apps/client/src/components/GameUI/NotificationFeed.tsx` — transient game feedback.
- `apps/client/src/components/GameUI/CityInfoOverlay.tsx` — detailed city dialog.
- `apps/client/src/components/GameUI/UnitContextMenu.tsx` — unit action menu.
- `apps/client/src/store/gameStore.ts` — selected unit/city, focus queues, map, player, and turn state.

The main structural limitation is that `GameLayout` currently treats the map, government, research, nations, cities, and options as mostly separate screens. The HUD should make the map persistent and layer contextual UI over it.

## Target composition

```text
┌──────────────────────────────────────────────────────────────┐
│ Resource bar · turn/year · player identity · global actions   │
├───────┬──────────────────────────────────────────────┬───────┤
│       │                                              │       │
│ Goals │                    Map                       │ Diplomacy
│ /     │     city labels · unit labels · alerts       │ /      │
│Journal│                                              │ leaders│
│       │                                              │       │
├───────┴──────────────────────────────────────────────┴───────┤
│ Minimap       Selected unit/city context tray     End turn   │
└──────────────────────────────────────────────────────────────┘
```

The exact layout can change with screen size. The ownership of each information group should remain stable.

## Visual direction for overlays

HUD overlays should be slightly transparent to preserve the map as the primary surface and create a modern layered feel.

The overall look and feel should be modern, clean, and slightly futuristic: restrained enough to keep the game state legible, but with enough precision and contrast to feel like a strategic command interface.

### Nation identity placeholders

Portrait and custom nation assets will be provided later. Until then, the HUD should use a consistent placeholder identity system:

- Use the authoritative player/nation color as the primary identity cue.
- Use colored circles, shield shapes, or compact geometric badges instead of temporary emoji avatars.
- Show the nation name and leader name alongside the placeholder wherever identity matters.
- Keep the placeholder component API compatible with future flag and portrait assets.
- Do not encode asset paths directly into diplomacy, status, or HUD components.

Future assets should be able to replace the placeholder through a shared component such as `NationInsignia` or `LeaderPortrait`, without changing panel layout or game-state contracts.

Guidelines:

- Use translucent panel backgrounds rather than fully opaque blocks.
- Apply a subtle backdrop blur where supported, with a solid fallback for browsers that do not support it.
- Keep borders, shadows, and separators restrained so the HUD does not overpower the map.
- Prefer clean geometric layout, generous spacing, and clear information hierarchy over decorative framing.
- Use a compact sans-serif type system with strong numeric styling for resources, turns, progress, and combat values.
- Use a dark neutral base with controlled cool accents such as blue, cyan, violet, or teal for interactive and futuristic emphasis.
- Reserve warm colors such as amber, orange, and red for warnings, danger, shortages, and urgent actions.
- Use consistent line weights, icon sizes, corner radii, and alignment across all HUD regions.
- Favor crisp vector icons and simple symbols over emoji or highly ornamental controls in the final HUD.
- Use subtle transitions for opening, closing, selection, and value changes; avoid constant motion or distracting animation.
- Use stronger opacity for active, selected, or urgent states.
- Preserve sufficient contrast for text, icons, disabled states, and resource deltas.
- Avoid transparency for critical confirmation dialogs, destructive actions, or dense data tables where readability is more important than seeing the map underneath.
- Use one shared surface system so top bars, trays, minimaps, and side panels feel related.

Suggested surface tokens:

```css
--hud-surface: rgb(15 23 42 / 78%);
--hud-surface-elevated: rgb(15 23 42 / 90%);
--hud-surface-active: rgb(30 41 59 / 88%);
--hud-border: rgb(148 163 184 / 24%);
--hud-shadow: 0 10px 30px rgb(0 0 0 / 24%);
```

Acceptance criteria:

- The map remains perceptible through passive HUD surfaces.
- Text and controls remain readable over light and dark map terrain.
- Active and urgent panels have a clear visual increase in contrast.
- Dense reports and dialogs can intentionally opt into an opaque surface.
- The transparency treatment is implemented through shared components or tokens, not one-off per-panel styles.
- The visual language is consistent across the HUD, dialogs, reports, and contextual trays.
- Futuristic accents support hierarchy and interaction rather than becoming decoration for its own sake.

## Work breakdown

## Implementation status — July 30, 2026

Status reflects the current codebase, including the latest committed HUD and
synchronization work. “Complete” means the planned UI surface is implemented
at the current contract boundary; it does not include deferred visual polish,
future art assets, or backend capabilities explicitly called out as
unavailable.

| Slice                                              | Status                      | Current assessment                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Authoritative data contract and synchronization | **Partial / high priority** | Authoritative phase is now propagated through game-start and turn-start packets. Score remains inconsistent between live player info and snapshot paths; tax/luxury/science rates and related contract tests still need completion. Unit and city fields are largely present, but normalization coverage should be tightened. |
| 1. HUD foundations                                 | **Complete**                | `GameHud`, shared HUD surfaces/buttons, named regions, map-first composition, pointer-event handling, responsive layout, and overlay/dialog integration are implemented.                                                                                                                                                      |
| 2. Persistent top resource bar                     | **Complete**                | `StatusPanel` exposes resources, deltas, turn/year, government, nation identity placeholder, phase, connection, and pending-action state with report/government entry points.                                                                                                                                                 |
| 3. Bottom contextual selection tray                | **Complete**                | `SelectionTray` supports no selection, unit selection, city selection, capability-aware actions, disabled explanations, focus queues, and city details access.                                                                                                                                                                |
| 4. Map annotations and selection feedback          | **Complete**                | City and unit labels, production/status indicators, selected-state feedback, movement/path preview, destination markers, and pending order presentation are implemented in the 2D renderers and map interaction layer.                                                                                                        |
| 5. Minimap / overview map                          | **Complete**                | The minimap renders known terrain/ownership, cities and units, viewport context, selected markers, click navigation, collapse behavior, and narrow-screen handling.                                                                                                                                                           |
| 6. Left objectives / journal panel                 | **Complete**                | `ObjectivesJournal` exposes research/objectives, city attention, units awaiting orders, recent events, urgency, navigation, collapse, and mobile behavior.                                                                                                                                                                    |
| 7. Right diplomacy / leader strip                  | **Partial**                 | `DiplomacyStrip` supports known nations, relationship/proposal summaries, leader identity placeholders, treaty actions, intelligence access, collapse, and mobile behavior. Embassy/shared-vision indicators and coordinate-based map centering remain blocked by unavailable backend data.                                   |
| 8. Bottom-right turn and global action cluster     | **Complete**                | End-turn, blocked-turn explanations, urgent-action review, reports, settings, help/Civilopedia, chat entry, keyboard dismissal, and responsive overflow are implemented.                                                                                                                                                      |
| 9. Reports and information panels                  | **Complete**                | Scores/history, demographics, climate, unit, intelligence, space race, war calculator, and Civilopedia surfaces are implemented and accessible from the HUD.                                                                                                                                                                  |

### Current implementation position

The persistent HUD milestone is implemented. High-priority work should now
focus on completing Slice 0 before additional polish: unify authoritative
score/economy data across all snapshot paths, verify FE normalization for the
fields already emitted by the BE, and add regression coverage. Diplomacy
capabilities that require new backend contracts should remain explicitly
blocked rather than inferred in the UI. Visual polish, final assets, and
non-critical interaction refinements remain deferred.

### Slice 0 — Authoritative data contract and synchronization cleanup

Complete this slice before implementing persistent HUD components. The HUD will expose more game state continuously, so missing or lossy FE normalization becomes much more visible once the map is surrounded by status panels.

#### Player state

- Replace the live player `score: 0` placeholder with an authoritative score value.
- Expose tax, luxury, and science rates in the normal player snapshot or a clearly associated player-economy snapshot.
- Preserve team identity where relevant.
- Preserve spaceship state for later victory UI.
- Keep culture/history available for status and reports.

#### Unit state

Preserve the unit metadata already produced by the BE:

- Home city.
- Upkeep costs.
- Nationality.
- Activity target.
- Transported, occupied, paradropped, done-moving, and stay state.
- Facing direction and birth turn.

The FE normalization layer should map BE field names into stable FE names instead of dropping fields during `UNIT_INFO` handling.

#### City state

Add the city fields needed for HUD labels and empire reports:

- Capital status.
- Founded turn.
- Defense strength.
- Health level.
- Culture per turn.
- Detailed trade-route metadata, including status, distance, and establishment turn.

Keep rally-point support explicitly marked as unavailable until the BE implements it.

#### Turn and phase state

- Stop hard-coding the client phase to `movement` when processing `GAME_INFO`.
- Preserve the authoritative phase from the BE.
- Confirm that turn-processing, freeze/thaw, and pending-action state are available to the HUD.

#### Acceptance criteria

- FE models contain every field needed by the first HUD milestone.
- No UI-critical BE fields are silently discarded by `GameClient`.
- Live score is non-zero and authoritative when the game supports it.
- Resource rates, unit home city, and unit status are available without extra per-component requests.
- Client phase matches the server phase.
- Packet and normalization tests cover the new fields.

Primary files:

- `apps/server/src/game/orchestrators/GameBroadcastManager.ts`
- `apps/server/src/game/services/CityDataService.ts`
- `apps/client/src/services/GameClient.ts`
- `apps/client/src/types/index.ts`
- `apps/client/src/types/packets.ts`

This slice should be treated as a prerequisite for all subsequent HUD slices.

#### Current data boundaries and follow-up BE work

The current HUD implementation must keep these fields explicit rather than
deriving or inventing values:

- **Culture:** available as `Player.culture`, with `history` as the client
  fallback for the resource bar.
- **Faith:** no authoritative player or economy field is currently present in
  the BE/FE contract. Do not render a zero or repurpose luxury as faith; add a
  ruleset-backed field and packet only if faith becomes part of the supported
  game model.
- **Strategic resources:** tile `resource` values are available when known,
  but there is no aggregate per-player inventory/stockpile contract. A future
  strategic-resource widget requires an authoritative inventory snapshot,
  visibility rules, and update events.
- **Diplomacy locations:** diplomacy records do not contain coordinates. Map
  centering must use only a city or unit already present in the client’s
  permitted snapshot; unknown nations must not receive inferred locations.

These boundaries are UI acceptance constraints until the corresponding BE
contracts are implemented and covered by packet/normalization tests.

### Slice 1 — HUD foundations

Create the layout primitives and conventions needed by all later slices.

Deliverables:

- `GameHud` overlay root mounted above `MapCanvas`.
- Named regions: `top`, `left`, `right`, `bottom-left`, `bottom-center`, `bottom-right`.
- Shared panel, icon button, tooltip, badge, resource item, and collapse primitives.
- Pointer-event rules so transparent HUD areas do not block map input.
- Responsive behavior for desktop, tablet, and narrow screens.
- Z-index and focus-management conventions for overlays and dialogs.

Acceptance criteria:

- The map remains mounted and interactive while HUD panels are visible.
- HUD regions can be independently hidden or collapsed.
- Existing city and unit dialogs continue to open correctly.
- No gameplay logic is moved into presentational components.

Primary files:

- `GameLayout.tsx`
- new `GameHud.tsx`
- new `HudPanel.tsx`
- new `HudIconButton.tsx`

### Slice 2 — Persistent top resource bar

Replace the current compact header with a persistent resource/status strip.

Display:

- Gold balance and per-turn delta.
- Science balance and per-turn delta.
- Luxury/trade values when available.
- Population or citizen total.
- Current turn and game year.
- Current government.
- Player nation identity.
- Connection, turn phase, and pending-action status.

Interactions:

- Clicking rates/economy opens the tax-rate panel.
- Clicking government opens the government panel.
- Clicking turn/year opens demographics or reports when implemented.
- Overflow actions remain accessible on narrow screens.

Acceptance criteria:

- Values update from the store without polling in the component.
- Positive, negative, and neutral deltas are visually distinct.
- Missing values have explicit fallback states.
- The bar remains readable at the minimum supported viewport width.

### Slice 3 — Bottom contextual selection tray

Create one persistent bottom-center tray whose contents depend on selection.

#### No selection

- Short instruction or current phase summary.
- Pending unit count and urgent-action count.
- Optional recent notification summary.

#### Unit selected

- Unit type and name.
- Health, movement, veteran status, fuel, and cargo state where applicable.
- Current location and owner.
- Primary action buttons.
- Secondary action menu.
- Move/order state and cancel-order action.

#### City selected

- City name and population.
- Growth status.
- Current production and completion estimate.
- Key food, production, gold, and science values.
- Open city details action.

Acceptance criteria:

- Selecting a unit or city updates the tray immediately.
- Buttons are capability-aware and disabled with an explanation when unavailable.
- All actions use existing `GameClient` methods or clearly identify missing transport work.
- The tray does not duplicate the full city dialog or unit context menu.

Primary files:

- new `SelectionTray.tsx`
- new `SelectedUnitSummary.tsx`
- new `SelectedCitySummary.tsx`
- `MapCanvas.tsx`
- `UnitContextMenu.tsx`

### Slice 4 — Map annotations and selection feedback

Make important map state readable without opening a panel.

Display:

- City nameplates with population and production/attention indicators.
- Selected city boundary and workable area when relevant.
- Unit name/type labels for the selected or active unit.
- Movement range and path preview.
- Destination marker and pending order state.
- Attention markers for cities in disorder, starvation, idle production, or pending management.

Acceptance criteria:

- Labels respect fog-of-war and visibility rules.
- Labels do not permanently obscure the map at normal zoom/viewport sizes.
- Selected state is visually distinct from hover state.
- Annotations use the same player colors as borders and city presentation.

Primary files:

- `MapCanvas.tsx`
- `MapRenderer.ts`
- `CityRenderer.ts`
- `UnitRenderer.ts`
- new `MapAnnotationLayer.tsx` or renderer equivalent

### Slice 5 — Minimap / overview map

Implement the missing overview map as a map overlay.

Display:

- Entire known world.
- Terrain and ownership at simplified resolution.
- Cities and major units as markers.
- Current viewport rectangle.
- Optional selected-unit and selected-city markers.

Interactions:

- Click or drag to reposition the main map viewport.
- Collapse/minimize control.
- Respect fog-of-war.

Acceptance criteria:

- Clicking the minimap centers the main map predictably.
- Viewport rectangle tracks map panning and resizing.
- Minimap rendering is throttled and does not reduce main-map responsiveness.
- The minimap can be disabled on narrow screens.

### Slice 6 — Left objectives / journal panel

Create a collapsible left-side panel for non-spatial guidance.

Initial content:

- Current research goal.
- Current legacy/objective items when available.
- Unresolved city alerts.
- Units awaiting orders.
- Recent major events.

Later content:

- Victory progress.
- Wonders or project progress.
- Scenario objectives.
- Narrative choices.

Acceptance criteria:

- Items link to the relevant screen, city, unit, or map location.
- Urgent items are distinguishable from informational items.
- The panel can be collapsed without losing notifications.
- Empty state is useful rather than visually dominant.

### Slice 7 — Right diplomacy / leader strip

Create a compact diplomacy surface that summarizes the current world state.

Display:

- Known nations and leader identities.
- Diplomatic state.
- War/peace/alliances.
- Pending treaty proposals.
- Embassy/shared-vision indicators.
- Alerts for new contact or diplomatic changes.

Interactions:

- Click a leader to open the relevant nation card.
- Open intelligence report when available.
- Center the map on known cities or units where allowed.

Acceptance criteria:

- Unknown nations do not leak hidden information.
- Diplomatic state uses the same state labels and colors as `NationsPanel`.
- Pending proposals are actionable without requiring a full tab switch.

### Slice 8 — Bottom-right turn and global action cluster

Group turn progression and high-frequency global actions.

Display/actions:

- End turn / turn done.
- Cancel or acknowledge urgent actions.
- Reports.
- Settings/menu.
- Help/Civilopedia.
- Chat when enabled.

Acceptance criteria:

- End turn remains prominent and keyboard-accessible.
- The user can see why ending the turn is blocked or discouraged.
- Secondary actions do not compete visually with the primary turn action.
- The cluster collapses into an overflow menu on narrow screens.

### Slice 9 — Reports and information panels

Add the larger information surfaces identified in the UI audit.

Recommended order:

1. Game scores and historical charts.
2. Demographics report.
3. Climate report.
4. Empire/unit/upkeep reports.
5. Intelligence reports.
6. Space race report.
7. War calculator.
8. Help/Civilopedia.

These should open as panels or dialogs from the HUD rather than becoming additional permanent top-level tabs by default.

## Suggested state additions

The existing store already contains the core selection state. The HUD will likely need a small UI-only state section:

```ts
interface HudUiState {
  leftPanel: 'open' | 'collapsed';
  rightPanel: 'open' | 'collapsed';
  minimap: 'open' | 'collapsed';
  activeTray: 'none' | 'unit' | 'city';
  openReport?:
    | 'scores'
    | 'demographics'
    | 'climate'
    | 'empire'
    | 'intelligence'
    | 'spaceship'
    | 'warcalc'
    | 'help';
}
```

Keep this separate from authoritative game state. HUD expansion should not add duplicated copies of player, city, unit, or diplomacy data.

## Dependency order

```text
Authoritative data contract and synchronization cleanup
      │
      └── HUD foundations
            │
            ├── Top resource bar
            ├── Selection tray ── Map annotations
            ├── Minimap
            ├── Journal / objectives
            ├── Diplomacy strip
            └── Turn/action cluster
                          │
                          └── Reports and larger information surfaces
```

## Recommended first milestone

The first useful milestone should include only five slices:

1. Authoritative data contract and synchronization cleanup.
2. HUD foundations.
3. Top resource bar.
4. Bottom contextual selection tray.
5. Minimap.

This first stabilizes the data that the HUD will expose, then creates the new persistent composition without requiring new game systems. It gives the team a reliable shell into which objectives, diplomacy, reports, and additional widgets can be added incrementally.

## Explicit non-goals

- Replacing the 2D renderer with 3D.
- Matching the reference game's art direction.
- Rewriting existing city, diplomacy, or unit actions.
- Moving every existing tab into the HUD.
- Adding decorative panels that do not expose actionable information.

## Definition of done for the HUD project

- The map is always the primary surface during active play.
- Core resources, turn status, and urgent actions are visible without opening a tab.
- Unit and city selection expose the most relevant actions in a consistent bottom tray.
- The minimap supports fast navigation.
- Objectives, diplomacy, and notifications have clear ownership and priority.
- Larger reports remain discoverable from the HUD.
- Existing keyboard controls, dialogs, and gameplay actions remain functional.
- The layout works at desktop and narrow viewport sizes.
