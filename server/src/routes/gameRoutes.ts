import { Router, Request, Response, NextFunction } from 'express';
import { GameService } from '../services/gameService';
import { z } from 'zod';

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

const router = Router();
const gameService = new GameService();

// Validation schemas
const createGameSchema = z.object({
  name: z.string().min(1).max(100),
  settings: z.object({
    mapSize: z.enum(['small', 'medium', 'large']),
    turnTimer: z.number().min(60).max(1800),
    allowSpectators: z.boolean(),
  }),
});

const joinGameSchema = z.object({
  civilization: z.string().min(1).max(50),
});

const moveUnitSchema = z.object({
  unitId: z.string().uuid(),
  x: z.number().int().min(0).max(100),
  y: z.number().int().min(0).max(100),
});

// Mock authentication middleware (replace with real auth later)
const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Use the real Supabase user ID
    const testUserId = 'cca02617-25eb-4a44-8f6a-7575033cf5a3';

    // Try to get or create the test profile
    const { data: existingProfile } =
      await gameService.getOrCreateTestUser(testUserId);

    req.user = { id: testUserId };
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Get all available games
router.get('/', async (req: Request, res: Response) => {
  try {
    const { data, error } = await gameService.getAvailableGames();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ games: data });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new game
router.post(
  '/',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validatedData = createGameSchema.parse(req.body);

      const { data, error } = await gameService.createGame(
        req.user!.id,
        validatedData.name,
        validatedData.settings
      );

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(201).json({ game: data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid input', details: err.issues });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Get a specific game
router.get('/:gameId', async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const { data, error } = await gameService.getGame(gameId!);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Game not found' });
    }

    return res.json({ game: data });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Join a game
router.post(
  '/:gameId/join',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { gameId } = req.params;
      const validatedData = joinGameSchema.parse(req.body);

      const { data, error } = await gameService.joinGame(
        gameId!,
        req.user!.id,
        validatedData.civilization
      );

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ gamePlayer: data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid input', details: err.issues });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Start a game
router.post(
  '/:gameId/start',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { gameId } = req.params;

      const { data, error } = await gameService.startGame(gameId!);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ message: 'Game started successfully' });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Get game state
router.get('/:gameId/state', async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    const gameState = await gameService.getGameState(gameId!);

    if (gameState.error) {
      return res.status(500).json({ error: gameState.error.message });
    }

    return res.json({
      map: gameState.map,
      units: gameState.units,
      cities: gameState.cities,
      players: gameState.players,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Move unit
router.post(
  '/:gameId/actions/move-unit',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validatedData = moveUnitSchema.parse(req.body);

      const { data, error } = await gameService.moveUnit(
        validatedData.unitId,
        validatedData.x,
        validatedData.y,
        req.user!.id
      );

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ unit: data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid input', details: err.issues });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// End turn
router.post(
  '/:gameId/actions/end-turn',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { gameId } = req.params;

      const { data, error } = await gameService.endTurn(gameId!, req.user!.id);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ game: data });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
