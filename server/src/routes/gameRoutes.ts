import { Router } from 'express';
import { GameService } from '../services/gameService';
import { z } from 'zod';

const router = Router();
const gameService = new GameService();

// Validation schemas
const createGameSchema = z.object({
  name: z.string().min(1).max(100),
  settings: z.object({
    mapSize: z.enum(['small', 'medium', 'large']),
    turnTimer: z.number().min(60).max(1800),
    allowSpectators: z.boolean()
  })
});

const joinGameSchema = z.object({
  civilization: z.string().min(1).max(50)
});

const moveUnitSchema = z.object({
  unitId: z.string().uuid(),
  x: z.number().int().min(0).max(100),
  y: z.number().int().min(0).max(100)
});

// Mock authentication middleware (replace with real auth later)
const requireAuth = (req: any, res: any, next: any) => {
  // For now, use a mock user ID (valid UUID format)
  req.user = { id: '550e8400-e29b-41d4-a716-446655440000' };
  next();
};

// Get all available games
router.get('/', async (req, res) => {
  try {
    const { data, error } = await gameService.getAvailableGames();
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ games: data });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new game
router.post('/', requireAuth, async (req, res) => {
  try {
    const validatedData = createGameSchema.parse(req.body);
    
    const { data, error } = await gameService.createGame(
      req.user.id,
      validatedData.name,
      validatedData.settings
    );
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.status(201).json({ game: data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific game
router.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { data, error } = await gameService.getGame(gameId);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    if (!data) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    res.json({ game: data });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Join a game
router.post('/:gameId/join', requireAuth, async (req, res) => {
  try {
    const { gameId } = req.params;
    const validatedData = joinGameSchema.parse(req.body);
    
    const { data, error } = await gameService.joinGame(
      gameId,
      req.user.id,
      validatedData.civilization
    );
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ gamePlayer: data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start a game
router.post('/:gameId/start', requireAuth, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const { data, error } = await gameService.startGame(gameId);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ message: 'Game started successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get game state
router.get('/:gameId/state', async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const gameState = await gameService.getGameState(gameId);
    
    if (gameState.error) {
      return res.status(500).json({ error: gameState.error.message });
    }
    
    res.json({
      map: gameState.map,
      units: gameState.units,
      cities: gameState.cities,
      players: gameState.players
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Move unit
router.post('/:gameId/actions/move-unit', requireAuth, async (req, res) => {
  try {
    const validatedData = moveUnitSchema.parse(req.body);
    
    const { data, error } = await gameService.moveUnit(
      validatedData.unitId,
      validatedData.x,
      validatedData.y,
      req.user.id
    );
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ unit: data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// End turn
router.post('/:gameId/actions/end-turn', requireAuth, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const { data, error } = await gameService.endTurn(gameId, req.user.id);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ game: data });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
