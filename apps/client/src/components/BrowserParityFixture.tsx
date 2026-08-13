/**
 * @module client/components/BrowserParityFixture
 * Defines the Browser Parity Fixture client UI component.
 */
import { useEffect, useState } from 'react';
import type { City, Tile } from '../types';
import { useGameStore } from '../store/gameStore';
import { GameLayout } from './GameUI/GameLayout';
import { TOPOLOGY_HEX, TOPOLOGY_ISO } from './Canvas2D/mapTopologyGeometry';

const C2C3_TOPOLOGY = TOPOLOGY_ISO | TOPOLOGY_HEX;
const C2C3_WRAP = 3;

const makeCity = (x = 2, y = 2): City => ({
  id: 'city-kyoto',
  name: 'Kyoto',
  playerId: 'player-one',
  x,
  y,
  size: 8,
  food: 5,
  shields: 4,
  trade: 3,
  history: 12,
  prod: { food: 5, shields: 4, trade: 3, gold: 1, luxury: 1, science: 1 },
  surplus: { food: 2, shields: 2, trade: 3, gold: 1, luxury: 1, science: 1 },
  waste: { shields: 0, trade: 0 },
  foodStock: 10,
  granarySize: 20,
  granaryTurns: 5,
  citizens: { happy: 2, content: 4, unhappy: 1, angry: 1, specialists: {} },
  buildings: [{ id: 'city_walls', name: 'city_walls', upkeep: 0, sellable: true }],
  presentUnits: ['unit-one'],
  supportedUnits: ['unit-one'],
  production: {
    target: 'settlers',
    type: 'unit',
    progress: 12,
    cost: 40,
    turnsToComplete: 7,
  },
  worklist: [],
  tradeRoutes: [],
  celebrating: false,
  disorder: false,
  pollution: 0,
});

const seedFixture = (): void => {
  const query = new URLSearchParams(window.location.search);
  const showEndGame = query.get('state') === 'endgame';
  const isometricVisual = query.get('visual') === 'isometric';
  const parityMode = query.get('parity');
  const queryDimension = (name: string, fallback: number): number => {
    const value = Number.parseInt(query.get(name) ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const nativeReferenceVisual = isometricVisual && parityMode === 'native-reference';
  const referenceEntityVisual = isometricVisual && parityMode === 'reference-entities';
  const referenceEffectsVisual = isometricVisual && parityMode === 'reference-effects';
  const referenceWrappedVisual = isometricVisual && parityMode === 'reference-wrapped';
  const referenceParityVisual =
    isometricVisual &&
    (parityMode === 'reference' ||
      parityMode === 'reference-base' ||
      parityMode === 'reference-entities' ||
      parityMode === 'reference-effects' ||
      parityMode === 'reference-wrapped' ||
      nativeReferenceVisual);
  const referenceBaseVisual = isometricVisual && parityMode === 'reference-base';
  const mapWidth = isometricVisual ? queryDimension('mapWidth', 48) : 5;
  const mapHeight = isometricVisual ? queryDimension('mapHeight', 48) : 5;
  // Keep the entity oracle near the finite board's south-east edge. Centering
  // on this tile reaches beyond the map at the lower canvas corners, so both
  // renderers exercise freeciv-web's opaque edge clear before composition.
  const cityX = isometricVisual
    ? referenceEntityVisual || referenceEffectsVisual
      ? Math.floor((mapWidth * 3) / 4)
      : Math.floor(mapWidth / 2)
    : 2;
  const cityY = isometricVisual
    ? referenceEntityVisual || referenceEffectsVisual
      ? Math.floor((mapHeight * 3) / 4)
      : Math.floor(mapHeight / 2)
    : 2;
  const stackedUnitX = Math.min(mapWidth - 1, cityX + 6);
  const stackedUnitY = Math.max(0, cityY - 1);
  const wrappedSeamY = Math.floor(mapHeight / 2);
  const terrain = [
    'deep_ocean',
    'coast',
    'grassland',
    'plains',
    'forest',
    'hills',
    'mountains',
    'desert',
    'jungle',
  ];
  const tiles: Tile[] = [];
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const isVisualRiver = isometricVisual && !referenceBaseVisual && x === 23 && y === 23;
      const isVisualCoastOutlet = isometricVisual && !referenceBaseVisual && x === 24 && y === 23;
      const visualTerrain = isVisualCoastOutlet
        ? 'coast'
        : isVisualRiver
          ? 'plains'
          : terrain[(x + y * 2) % terrain.length];
      const visualOwner = referenceParityVisual
        ? undefined
        : isometricVisual && x >= 12 && x <= 36 && y >= 12 && y <= 36
          ? 'player-one'
          : isometricVisual && x >= 38 && y >= 12 && y <= 34
            ? 'player-two'
            : undefined;
      tiles.push({
        x,
        y,
        terrain: visualTerrain,
        visible: referenceWrappedVisual
          ? !(x === mapWidth - 1 && y === wrappedSeamY)
          : isometricVisual
            ? !(x === mapWidth - 1 && y === 0)
            : !(x === 4 && y === 0),
        known: referenceWrappedVisual
          ? !(x === mapWidth - 1 && y === wrappedSeamY + 1)
          : isometricVisual
            ? !(x === mapWidth - 1 && y === 1)
            : !(x === 4 && y === 1),
        resource: isometricVisual
          ? !referenceBaseVisual && x === 26 && y === 22
            ? 'gold'
            : undefined
          : x === 3 && y === 2
            ? 'gold'
            : undefined,
        riverMask: isVisualRiver ? 2 : !isometricVisual && x === 1 && y === 2 ? 10 : undefined,
        hasRoad: referenceBaseVisual
          ? false
          : referenceWrappedVisual
            ? y === wrappedSeamY && (x <= 1 || x >= mapWidth - 2)
            : isometricVisual
              ? y === 25 && x >= 15 && x <= 33
              : y === 3,
        hasRailroad: referenceBaseVisual
          ? false
          : referenceWrappedVisual
            ? y === wrappedSeamY + 1 && (x <= 1 || x >= mapWidth - 2)
            : isometricVisual
              ? y === 26 && x >= 17 && x <= 31
              : y === 4,
        improvements: referenceBaseVisual
          ? []
          : isometricVisual
            ? x === 22 && y === 25
              ? ['irrigation']
              : []
            : x === 1 && y === 1
              ? ['irrigation']
              : [],
        owner:
          referenceWrappedVisual && x === mapWidth - 1 && y === wrappedSeamY - 1
            ? 'player-one'
            : referenceWrappedVisual && x === 0 && y === wrappedSeamY - 1
              ? 'player-two'
              : referenceEntityVisual && x === cityX - 4 && y === cityY
                ? 'player-one'
                : referenceEntityVisual && x === cityX - 3 && y === cityY
                  ? 'player-two'
                  : referenceParityVisual
                    ? undefined
                    : (visualOwner ?? (x >= 1 && x <= 3 ? 'player-one' : undefined)),
        label:
          referenceWrappedVisual && x === 0 && y === wrappedSeamY + 2
            ? 'Seam'
            : referenceEntityVisual && x === cityX - 4 && y === cityY + 1
              ? 'Oracle'
              : undefined,
      });
    }
  }
  const city = makeCity(cityX, cityY);
  if (!referenceParityVisual || referenceEntityVisual) {
    tiles.find(tile => tile.x === city.x && tile.y === city.y)!.cityId = city.id;
  }
  const fixtureCities = referenceParityVisual && !referenceEntityVisual ? {} : { [city.id]: city };
  const fixtureUnits =
    referenceParityVisual && !referenceEntityVisual
      ? {}
      : {
          'unit-one': {
            id: 'unit-one',
            playerId: 'player-one',
            unitTypeId: 'warriors',
            x: cityX,
            y: cityY,
            hp: 8,
            maxHp: 10,
            movesLeft: 1,
            maxMoves: 1,
            veteranLevel: 0,
            fortified: true,
          },
          ...(isometricVisual
            ? {
                'unit-two': {
                  id: 'unit-two',
                  playerId: 'player-two',
                  unitTypeId: 'warriors',
                  x: stackedUnitX,
                  y: stackedUnitY,
                  hp: 5,
                  maxHp: 10,
                  movesLeft: 1,
                  maxMoves: 1,
                  veteranLevel: 1,
                  activity: referenceEntityVisual ? 'sentry' : undefined,
                  actionDecisionWant: referenceEntityVisual,
                },
                ...(referenceEntityVisual
                  ? {
                      'unit-three': {
                        id: 'unit-three',
                        playerId: 'player-two',
                        unitTypeId: 'settlers',
                        x: stackedUnitX,
                        y: stackedUnitY,
                        hp: 20,
                        maxHp: 20,
                        movesLeft: 1,
                        maxMoves: 1,
                        veteranLevel: 0,
                      },
                    }
                  : {}),
              }
            : {}),
        };

  const referenceEntities = referenceEntityVisual
    ? {
        cities: [
          {
            id: city.id,
            playerId: city.playerId,
            x: city.x,
            y: city.y,
            name: city.name,
            size: city.size,
            graphic: 'city.asian',
            graphicAlt: 'city.classical',
            walls: true,
            unhappy: city.disorder,
            occupied: city.occupied ?? false,
            production: { unitTypeId: 'settlers' },
          },
        ],
        units: [
          {
            id: 'unit-one',
            playerId: 'player-one',
            unitTypeId: 'warriors',
            graphic: 'u.warriors',
            graphicAlt: '-',
            x: city.x,
            y: city.y,
            hp: 8,
            maxHp: 10,
            veteranLevel: 0,
            activity: 'fortified',
          },
          {
            id: 'unit-two',
            playerId: 'player-two',
            unitTypeId: 'warriors',
            graphic: 'u.warriors',
            graphicAlt: '-',
            x: stackedUnitX,
            y: stackedUnitY,
            hp: 5,
            maxHp: 10,
            veteranLevel: 1,
            activity: 'sentry',
            actionDecisionWant: true,
          },
          {
            id: 'unit-three',
            playerId: 'player-two',
            unitTypeId: 'settlers',
            graphic: 'u.settlers',
            graphicAlt: '-',
            x: stackedUnitX,
            y: stackedUnitY,
            hp: 20,
            maxHp: 20,
            veteranLevel: 0,
          },
        ],
        showCitybar: true,
      }
    : undefined;

  const effectX = Math.max(0, cityX - 2);
  const effectY = Math.max(0, cityY - 2);
  const effectTile = tiles.find(tile => tile.x === effectX && tile.y === effectY);
  if (referenceEffectsVisual && effectTile) {
    effectTile.known = true;
    effectTile.visible = true;
  }
  const referenceEffects = referenceEffectsVisual
    ? {
        combat: { x: effectX, y: effectY },
        nuclear: { x: effectX + 3, y: effectY + 1 },
      }
    : undefined;

  const referenceBoardTopology =
    referenceParityVisual && !nativeReferenceVisual ? TOPOLOGY_ISO : C2C3_TOPOLOGY;
  const referenceBoardWrap = referenceWrappedVisual
    ? 1
    : referenceParityVisual && !nativeReferenceVisual
      ? 0
      : C2C3_WRAP;

  // Strict browser-painter fixtures use square ISO. The wrapped fixture keeps
  // Freeciv-web's X-period enabled and centers the camera directly over that
  // seam; the native-reference fixture continues to exercise C2C3 metadata.
  Object.assign(window, {
    map: {
      xsize: mapWidth,
      ysize: mapHeight,
      topology_id: referenceBoardTopology,
      wrap_id: referenceBoardWrap,
    },
    __civjsParityGeometry: {
      topologyId: C2C3_TOPOLOGY,
      wrapId: C2C3_WRAP,
    },
    __civjsParityEntities: referenceEntities,
    __civjsParityEffects: referenceEffects,
    tiles,
  });

  useGameStore.setState({
    clientState: 'running',
    currentGameId: 'browser-parity',
    currentPlayerId: 'player-one',
    // The fixture supplies its final entity state synchronously; prevent the
    // production startup-centering effect from replacing the oracle viewport.
    hasReceivedUnitSnapshot: true,
    turn: 42,
    year: 1200,
    activeTab: 'map',
    players: {
      'player-one': {
        id: 'player-one',
        name: 'Akiko',
        nation: 'japanese',
        color: '#dc2626',
        gold: 120,
        goldPerTurn: 3,
        science: 35,
        sciencePerTurn: 2,
        history: 20,
        government: 'republic',
        nationGraphic: 'japan',
        isHuman: true,
        isActive: true,
      },
      'player-two': {
        id: 'player-two',
        name: 'Caesar',
        nation: 'romans',
        color: '#2563eb',
        gold: 80,
        goldPerTurn: -1,
        science: 24,
        sciencePerTurn: 1,
        history: 16,
        government: 'monarchy',
        nationGraphic: 'rome',
        isHuman: false,
        isActive: true,
      },
    },
    map: {
      width: mapWidth,
      height: mapHeight,
      xsize: mapWidth,
      ysize: mapHeight,
      topology_id: referenceBoardTopology,
      wrap_id: referenceBoardWrap,
      tiles: Object.fromEntries(tiles.map(tile => [`${tile.x},${tile.y}`, tile])),
    },
    mapData: referenceParityVisual
      ? {
          width: mapWidth,
          height: mapHeight,
          startingPositions: [
            {
              playerId: 'player-one',
              x: cityX,
              y: cityY,
            },
          ],
          seed: 'browser-parity',
          generatedAt: new Date(0),
        }
      : undefined,
    cities: fixtureCities,
    units: fixtureUnits,
    presentationEffects: referenceEffectsVisual
      ? [
          {
            id: 'reference-combat-effect',
            type: 'combat',
            x: effectX,
            y: effectY,
            startedAt: performance.now(),
          },
          {
            id: 'reference-nuclear-effect',
            type: 'nuclear',
            x: effectX + 3,
            y: effectY + 1,
            startedAt: performance.now(),
            tiles: [
              { x: effectX + 3, y: effectY + 1 },
              { x: effectX + 4, y: effectY + 1 },
            ],
          },
        ]
      : [],
    research: {
      currentTech: 'writing',
      bulbsAccumulated: 20,
      bulbsLastTurn: 4,
      researchedTechs: new Set(['alphabet']),
      availableTechs: new Set(['writing']),
      futureTechs: 0,
    },
    technologies: {
      alphabet: {
        id: 'alphabet',
        name: 'Alphabet',
        cost: 20,
        requirements: [],
        discovered: true,
      },
      writing: {
        id: 'writing',
        name: 'Writing',
        cost: 40,
        requirements: ['alphabet'],
        discovered: false,
      },
    },
    governments: {
      republic: {
        id: 'republic',
        name: 'Republic',
        graphic: 'gov.republic',
        graphic_alt: '-',
        sound: 'e_revolution',
        sound_alt: '-',
        sound_alt2: '-',
        ruler_male_title: 'Consul %s',
        ruler_female_title: 'Consul %s',
        helptext: 'Representative government with strong trade and limited corruption.',
      },
    },
    diplomacy: {
      playerId: 'player-one',
      nations: [
        {
          id: 'player-two',
          civilization: 'Romans',
          leaderName: 'Caesar',
          isAlive: true,
          isAI: true,
          known: true,
          relation: {
            state: 'peace',
            sinceTurn: 31,
            embassy: true,
            sharedVision: false,
          },
        },
      ],
    },
    endGameReport: showEndGame
      ? {
          version: 1,
          gameId: 'browser-parity',
          turn: 42,
          year: 1200,
          reason: 'conquest',
          winnerPlayerId: 'player-one',
          winnerPlayerIds: ['player-one'],
          endedAt: '2026-07-27T12:00:00.000Z',
          standings: [
            {
              playerId: 'player-one',
              civilization: 'Japanese',
              score: 320,
              cities: 1,
              population: 8,
              units: 1,
              technologies: 12,
              history: 20,
              alive: true,
            },
            {
              playerId: 'player-two',
              civilization: 'Romans',
              score: 210,
              cities: 0,
              population: 0,
              units: 0,
              technologies: 9,
              history: 16,
              alive: false,
            },
          ],
        }
      : undefined,
    viewport: referenceBaseVisual
      ? { x: -400, y: -250, width: window.innerWidth, height: window.innerHeight }
      : referenceEntityVisual
        ? { x: -592, y: 1392, width: window.innerWidth, height: window.innerHeight }
        : referenceWrappedVisual
          ? {
              x: Math.round(-wrappedSeamY * 48 + 48 - window.innerWidth / 2),
              y: Math.round(wrappedSeamY * 24 + 24 - window.innerHeight / 2),
              width: window.innerWidth,
              height: window.innerHeight,
            }
          : referenceParityVisual && !nativeReferenceVisual
            ? { x: -592, y: 1392, width: window.innerWidth, height: window.innerHeight }
            : { x: -400, y: -250, width: 800, height: 600 },
  });
};

export const BrowserParityFixture = () => {
  useState(seedFixture);
  const viewport = useGameStore(state => state.viewport);

  useEffect(() => {
    Object.assign(window, { viewport });
  }, [viewport]);

  return <GameLayout rulesetName="civ2civ3" />;
};
