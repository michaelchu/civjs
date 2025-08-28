import { Request, Response, NextFunction } from 'express';
import { sessionCache } from '../database/redis';
import { db } from '../database';
import { users } from '../database/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

// Extend Express Request to include user info
declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    username?: string;
    sessionId?: string;
  }
}

/**
 * Authentication middleware for HTTP routes
 * Handles session-based authentication for serverless compatibility
 */
export async function authenticateUser(req: Request, res: Response, next: NextFunction) {
  try {
    // Check for session ID in headers or query params
    const sessionId =
      (req.headers['x-session-id'] as string) ||
      (req.query.sessionId as string) ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'No session ID provided. Use x-session-id header or sessionId query param.',
      });
    }

    // Get user ID from session cache
    const userId = await sessionCache.getSession(sessionId);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session. Please authenticate first.',
      });
    }

    // Get user details from database
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      // Session exists but user doesn't - clean up session
      await sessionCache.deleteSession(sessionId);
      return res.status(401).json({
        success: false,
        error: 'User not found. Please authenticate again.',
      });
    }

    // Update last seen
    await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));

    // Attach user info to request
    req.userId = userId;
    req.username = user.username;
    req.sessionId = sessionId;

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed due to server error',
    });
  }
}

/**
 * Optional authentication - adds user info if session exists but doesn't require it
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId =
      (req.headers['x-session-id'] as string) ||
      (req.query.sessionId as string) ||
      req.headers.authorization?.replace('Bearer ', '');

    if (sessionId) {
      const userId = await sessionCache.getSession(sessionId);
      if (userId) {
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });
        if (user) {
          req.userId = userId;
          req.username = user.username;
          req.sessionId = sessionId;
        }
      }
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    // Don't fail on optional auth errors
    next();
  }
}

/**
 * Login endpoint to create session (replaces Socket.IO authentication)
 */
export async function loginUser(req: Request, res: Response): Promise<void> {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Username is required',
      });
    }

    const trimmedUsername = username.trim();

    // Find or create user
    let user = await db.query.users.findFirst({
      where: eq(users.username, trimmedUsername),
    });

    let isNewUser = false;
    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({
          username: trimmedUsername,
          isGuest: true,
        })
        .returning();
      user = newUser;
      isNewUser = true;
    } else {
      // Update last seen for existing user
      await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, user.id));
    }

    // Create session
    const sessionId = `session_${user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await sessionCache.setSession(sessionId, user.id);

    logger.info(
      `User ${trimmedUsername} (${user.id}) ${isNewUser ? 'created account and ' : ''}logged in`
    );

    res.json({
      success: true,
      sessionId,
      userId: user.id,
      username: user.username,
      message: isNewUser ? 'Welcome to CivJS!' : 'Welcome back!',
      isNewUser,
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed due to server error',
    });
  }
}

/**
 * Logout endpoint to clean up session
 */
export async function logoutUser(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = req.sessionId;
    if (sessionId) {
      await sessionCache.deleteSession(sessionId);
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed due to server error',
    });
  }
}
