import { useState } from 'react';
import type { City, Tile } from '../types';
import { useGameStore } from '../store/gameStore';
import { GameLayout } from './GameUI/GameLayout';

const makeCity = (): City => ({
  id: 'city-kyoto',
  name: 'Kyoto',
  playerId: 'player-one',
  x: 2,
  y: 2,
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
  buildings: [{ id: 'city_walls', name: 'city_walls', upkeep: 0 }],
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
  const showEndGame = new URLSearchParams(window.location.search).get('state') === 'endgame';
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
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      tiles.push({
        x,
        y,
        terrain: terrain[(x + y * 2) % terrain.length],
        visible: !(x === 4 && y === 0),
        known: !(x === 4 && y === 1),
        resource: x === 3 && y === 2 ? 'gold' : undefined,
        riverMask: x === 1 && y === 2 ? 10 : undefined,
        hasRoad: y === 3,
        hasRailroad: y === 4,
        improvements: x === 1 && y === 1 ? ['irrigation'] : [],
        owner: x >= 1 && x <= 3 ? 'player-one' : undefined,
      });
    }
  }
  const city = makeCity();
  tiles.find(tile => tile.x === city.x && tile.y === city.y)!.cityId = city.id;

  Object.assign(window, {
    map: { xsize: 5, ysize: 5 },
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
      width: 5,
      height: 5,
      tiles: Object.fromEntries(tiles.map(tile => [`${tile.x},${tile.y}`, tile])),
    },
    cities: { [city.id]: city },
    units: {
      'unit-one': {
        id: 'unit-one',
        playerId: 'player-one',
        unitTypeId: 'warriors',
        x: 2,
        y: 2,
        hp: 80,
        movesLeft: 1,
        maxMoves: 1,
        veteranLevel: 0,
        fortified: true,
      },
    },
    research: {
      currentTech: 'writing',
      bulbsAccumulated: 20,
      bulbsLastTurn: 4,
      researchedTechs: new Set(['alphabet']),
      availableTechs: new Set(['writing']),
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
    viewport: { x: -400, y: -250, width: 800, height: 600 },
  });
};

export const BrowserParityFixture = () => {
  useState(seedFixture);
  return <GameLayout />;
};
