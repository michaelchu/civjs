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
  const referenceParityVisual =
    isometricVisual &&
    (parityMode === 'reference' || parityMode === 'reference-base' || nativeReferenceVisual);
  const referenceBaseVisual = isometricVisual && parityMode === 'reference-base';
  const mapWidth = isometricVisual ? queryDimension('mapWidth', 48) : 5;
  const mapHeight = isometricVisual ? queryDimension('mapHeight', 48) : 5;
  const cityX = isometricVisual ? Math.floor(mapWidth / 2) : 2;
  const cityY = isometricVisual ? Math.floor(mapHeight / 2) : 2;
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
        visible: isometricVisual ? !(x === mapWidth - 1 && y === 0) : !(x === 4 && y === 0),
        known: isometricVisual ? !(x === mapWidth - 1 && y === 1) : !(x === 4 && y === 1),
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
          : isometricVisual
            ? y === 25 && x >= 15 && x <= 33
            : y === 3,
        hasRailroad: referenceBaseVisual
          ? false
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
        owner: referenceParityVisual
          ? undefined
          : (visualOwner ?? (x >= 1 && x <= 3 ? 'player-one' : undefined)),
      });
    }
  }
  const city = makeCity(cityX, cityY);
  if (!referenceParityVisual) {
    tiles.find(tile => tile.x === city.x && tile.y === city.y)!.cityId = city.id;
  }

  // Preserve a finite ISO board in the two strict reference-painter modes: the
  // pinned browser harness cannot resolve wrapped map positions completely.
  // The normal visual fixture uses the real C2C3 topology/wrap metadata; that
  // metadata is also exposed separately so physical-overview tests can assert
  // the production contract without weakening the finite world-pixel oracle.
  Object.assign(window, {
    map: {
      xsize: mapWidth,
      ysize: mapHeight,
      topology_id: referenceParityVisual && !nativeReferenceVisual ? TOPOLOGY_ISO : C2C3_TOPOLOGY,
      wrap_id: referenceParityVisual && !nativeReferenceVisual ? 0 : C2C3_WRAP,
    },
    __civjsParityGeometry: {
      topologyId: C2C3_TOPOLOGY,
      wrapId: C2C3_WRAP,
    },
    tiles,
  });

  useGameStore.setState({
    clientState: 'running',
    currentGameId: 'browser-parity',
    currentPlayerId: 'player-one',
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
        isHuman: false,
        isActive: true,
      },
    },
    map: {
      width: mapWidth,
      height: mapHeight,
      xsize: mapWidth,
      ysize: mapHeight,
      topology_id: referenceParityVisual && !nativeReferenceVisual ? TOPOLOGY_ISO : C2C3_TOPOLOGY,
      wrap_id: referenceParityVisual && !nativeReferenceVisual ? 0 : C2C3_WRAP,
      tiles: Object.fromEntries(tiles.map(tile => [`${tile.x},${tile.y}`, tile])),
    },
    cities: referenceParityVisual ? {} : { [city.id]: city },
    units: referenceParityVisual
      ? {}
      : {
          'unit-one': {
            id: 'unit-one',
            playerId: 'player-one',
            unitTypeId: 'warriors',
            x: cityX,
            y: cityY,
            hp: 80,
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
                  x: 30,
                  y: 23,
                  hp: 50,
                  movesLeft: 1,
                  maxMoves: 1,
                  veteranLevel: 1,
                },
              }
            : {}),
        },
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
