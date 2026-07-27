/**
 * TurnPacketService - Handles turn-related packet communication
 *
 * This service abstracts all turn-related packet sending operations to match
 * the freeciv-web protocol, including NEW_YEAR, BEGIN_TURN, and END_TURN packets.
 *
 * @reference freeciv-web/javascript/packhand.js packet handling
 * @reference freeciv-web/javascript/packhand_gen.js packet types
 */

import { logger } from '@utils/logger';
import { Server as SocketServer } from 'socket.io';
import { PacketType, PROTOCOL_VERSION } from '@app-types/packet';

export interface TurnPacketData {
  gameId: string;
  turn: number;
  year: number;
  fragments?: number;
  playerId?: string;
}

export interface ProcessingStepData {
  gameId: string;
  step: string;
  label: string;
  completed: boolean;
  active?: boolean;
}

export class TurnPacketService {
  private io: SocketServer;
  private gameId: string;

  constructor(io: SocketServer, gameId: string) {
    this.io = io;
    this.gameId = gameId;
  }

  /**
   * Send NEW_YEAR packet to all players
   * @reference freeciv-web/javascript/packhand.js handle_new_year()
   * @reference freeciv-web/javascript/packhand_gen.js case 127
   */
  sendNewYearPacket(turn: number, year: number, fragments: number = 0): void {
    const packetData = {
      turn,
      year,
      fragments, // Calendar fragments for sub-year precision
    };

    logger.debug('Sending NEW_YEAR packet', {
      gameId: this.gameId,
      turn,
      year,
      fragments,
    });

    // Send to all players in the game
    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.NEW_YEAR,
      timestamp: Date.now(),
      data: packetData,
    });

    logger.info('NEW_YEAR packet sent', {
      gameId: this.gameId,
      turn,
      year,
    });
  }

  /**
   * Send BEGIN_TURN packet to all players
   * @reference freeciv-web/javascript/packhand.js handle_begin_turn()
   * @reference freeciv-web/javascript/packhand_gen.js case 128
   */
  sendBeginTurnPacket(turn: number, year: number): void {
    const packetData: TurnPacketData = {
      gameId: this.gameId,
      turn,
      year,
    };

    logger.debug('Sending BEGIN_TURN packet', {
      gameId: this.gameId,
      turn,
      year,
    });

    // Send to all players in the game
    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.BEGIN_TURN,
      timestamp: Date.now(),
      data: packetData,
    });

    logger.info('BEGIN_TURN packet sent', {
      gameId: this.gameId,
      turn,
      year,
    });
  }

  /**
   * Send END_TURN packet to all players
   * @reference freeciv-web/javascript/packhand.js handle_end_turn()
   * @reference freeciv-web/javascript/packhand_gen.js case 129
   */
  sendEndTurnPacket(turn: number, year: number): void {
    const packetData: TurnPacketData = {
      gameId: this.gameId,
      turn,
      year,
    };

    logger.debug('Sending END_TURN packet', {
      gameId: this.gameId,
      turn,
      year,
    });

    // Send to all players in the game
    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.END_TURN,
      timestamp: Date.now(),
      data: packetData,
    });

    logger.info('END_TURN packet sent', {
      gameId: this.gameId,
      turn,
      year,
    });
  }

  /**
   * Send turn processing step update to all players
   * This provides real-time feedback during turn processing
   */
  sendProcessingStepPacket(step: string, label: string, completed: boolean = false): void {
    const packetData: ProcessingStepData = {
      gameId: this.gameId,
      step,
      label,
      completed,
      active: !completed,
    };

    logger.debug('Sending TURN_PROCESSING_STEP packet', {
      gameId: this.gameId,
      step,
      label,
      completed,
    });

    // Send to all players in the game
    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.TURN_PROCESSING_STEP,
      timestamp: Date.now(),
      data: packetData,
    });
  }

  /**
   * Send turn processing completion notification
   */
  sendProcessingCompletePacket(): void {
    const packetData: ProcessingStepData = {
      gameId: this.gameId,
      step: 'complete',
      label: 'Turn processing complete',
      completed: true,
      active: false,
    };

    logger.debug('Sending turn processing complete packet', {
      gameId: this.gameId,
    });

    // Send to all players in the game
    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.TURN_PROCESSING_STEP,
      timestamp: Date.now(),
      data: packetData,
    });

    logger.info('Turn processing complete packet sent', {
      gameId: this.gameId,
    });
  }

  /**
   * Send FREEZE_CLIENT packet to temporarily disable client interactions
   * @reference freeciv-web/javascript/packhand.js handle_freeze_client()
   */
  sendFreezeClientPacket(reason?: string): void {
    const packetData = {
      gameId: this.gameId,
      reason: reason || 'Processing turn',
    };

    logger.debug('Sending FREEZE_CLIENT packet', {
      gameId: this.gameId,
      reason,
    });

    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.FREEZE_CLIENT,
      timestamp: Date.now(),
      data: packetData,
    });
  }

  /**
   * Send THAW_CLIENT packet to re-enable client interactions
   * @reference freeciv-web/javascript/packhand.js handle_thaw_client()
   */
  sendThawClientPacket(message?: string): void {
    const packetData = {
      gameId: this.gameId,
      message: message || 'Turn processing complete',
    };

    logger.debug('Sending THAW_CLIENT packet', {
      gameId: this.gameId,
      message,
    });

    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.THAW_CLIENT,
      timestamp: Date.now(),
      data: packetData,
    });
  }

  /**
   * Send complete turn sequence: NEW_YEAR -> BEGIN_TURN
   * This matches the freeciv-web turn start sequence
   */
  sendTurnStartSequence(turn: number, year: number, fragments: number = 0): void {
    logger.info('Sending turn start sequence', {
      gameId: this.gameId,
      turn,
      year,
      fragments,
    });

    // Send packets in the correct order
    this.sendNewYearPacket(turn, year, fragments);

    // Send BEGIN_TURN immediately after NEW_YEAR to avoid timing issues with turn overlay
    // The original delay was causing BEGIN_TURN to be sent during city production processing
    this.sendBeginTurnPacket(turn, year);
  }

  /**
   * Send turn processing sequence with step-by-step updates
   */
  async sendTurnProcessingSequence(
    steps: Array<{ id: string; label: string }>,
    onStepComplete?: (stepId: string) => Promise<void>
  ): Promise<void> {
    logger.info('Starting turn processing sequence', {
      gameId: this.gameId,
      stepCount: steps.length,
    });

    for (const step of steps) {
      // Send step start
      this.sendProcessingStepPacket(step.id, step.label, false);

      // Execute step callback if provided
      if (onStepComplete) {
        try {
          await onStepComplete(step.id);
        } catch (error) {
          logger.error('Error in turn processing step', {
            gameId: this.gameId,
            stepId: step.id,
            error: error instanceof Error ? error.message : error,
          });
        }
      }

      // Send step completion
      this.sendProcessingStepPacket(step.id, step.label, true);

      // Small delay between steps for visual feedback
      await this.delay(100);
    }

    // Send overall completion
    this.sendProcessingCompletePacket();
  }

  /**
   * Utility method for creating delays in packet sequences
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send error notification during turn processing
   */
  sendTurnProcessingError(step: string, error: string): void {
    const packetData = {
      gameId: this.gameId,
      step: 'error',
      label: `Error in ${step}: ${error}`,
      completed: false,
      active: false,
      error: true,
    };

    logger.error('Sending turn processing error packet', {
      gameId: this.gameId,
      step,
      error,
    });

    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.TURN_PROCESSING_STEP,
      timestamp: Date.now(),
      data: packetData,
    });
  }

  /**
   * Broadcast turn statistics to all players
   */
  sendTurnStatistics(statistics: {
    turn: number;
    year: number;
    playersActive: number;
    unitsTotal: number;
    citiesTotal: number;
    actionsProcessed: number;
    processingTimeMs: number;
  }): void {
    logger.debug('Sending turn statistics', {
      gameId: this.gameId,
      statistics,
    });

    // Use SERVER_MESSAGE packet type for statistics
    this.io.to(`game:${this.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.SERVER_MESSAGE,
      timestamp: Date.now(),
      data: {
        type: 'turn_statistics',
        statistics,
      },
    });
  }
}
