// Debug script to test unit movement directly
const path = require('path');

// Mock the environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// Register TypeScript
require('ts-node').register({
  project: path.join(__dirname, 'apps/server/tsconfig.json'),
  transpileOnly: true
});

const { ActionSystem } = require('./apps/server/src/game/systems/ActionSystem.ts');
const { ActionType } = require('./apps/server/src/types/shared/actions.ts');
const { SINGLE_MOVE } = require('./apps/server/src/game/constants/MovementConstants.ts');

async function testMovement() {
  console.log('=== Testing Unit Movement ===');
  
  // Create a mock unit (warrior with 3 movement points)
  const unit = {
    id: 'test-unit-1',
    playerId: 'player1',
    unitTypeId: 'warriors',
    x: 5,
    y: 5,
    movementLeft: 3 * SINGLE_MOVE, // 3 full movement points
    orders: [],
    fortified: false
  };
  
  console.log('Initial unit state:', {
    position: { x: unit.x, y: unit.y },
    movementLeft: unit.movementLeft,
    unitType: unit.unitTypeId
  });

  // Create ActionSystem with mock pathfinding
  const actionSystem = new ActionSystem('test-game');
  actionSystem.setGameManagerCallback({
    requestPath: async (playerId, unitId, targetX, targetY) => {
      console.log(`Pathfinding request: unit ${unitId} to (${targetX}, ${targetY})`);
      // Mock path: move right one tile
      return {
        success: true,
        path: [
          { x: 5, y: 5 }, // current position  
          { x: 6, y: 5 }  // target position (1 tile right)
        ],
        cost: SINGLE_MOVE // 1 movement point cost
      };
    }
  });

  try {
    // First movement attempt
    console.log('\n=== First Movement Attempt ===');
    const result1 = await actionSystem.executeAction(unit, ActionType.GOTO, 6, 5);
    
    console.log('ActionSystem result:', {
      success: result1.success,
      message: result1.message,
      newPosition: result1.newPosition,
      newMovementLeft: result1.newMovementLeft,
      movementCost: result1.movementCost
    });
    
    // Simulate what UnitManager would do
    if (result1.newPosition) {
      unit.x = result1.newPosition.x;
      unit.y = result1.newPosition.y;
    }
    if (result1.newMovementLeft !== undefined) {
      unit.movementLeft = result1.newMovementLeft;
    }
    if (result1.newOrders !== undefined) {
      unit.orders = result1.newOrders;
    }
    
    console.log('Unit after first move:', {
      position: { x: unit.x, y: unit.y },
      movementLeft: unit.movementLeft,
      orders: unit.orders
    });

    // Second movement attempt - should still work
    console.log('\n=== Second Movement Attempt ===');
    actionSystem.setGameManagerCallback({
      requestPath: async (playerId, unitId, targetX, targetY) => {
        console.log(`Pathfinding request: unit ${unitId} to (${targetX}, ${targetY})`);
        // Mock path: move right one more tile
        return {
          success: true,
          path: [
            { x: 6, y: 5 }, // current position  
            { x: 7, y: 5 }  // target position (1 more tile right)
          ],
          cost: SINGLE_MOVE
        };
      }
    });
    
    const result2 = await actionSystem.executeAction(unit, ActionType.GOTO, 7, 5);
    
    console.log('ActionSystem result:', {
      success: result2.success,
      message: result2.message,
      newPosition: result2.newPosition,
      newMovementLeft: result2.newMovementLeft,
      movementCost: result2.movementCost
    });
    
    // Simulate what UnitManager would do
    if (result2.newPosition) {
      unit.x = result2.newPosition.x;
      unit.y = result2.newPosition.y;
    }
    if (result2.newMovementLeft !== undefined) {
      unit.movementLeft = result2.newMovementLeft;
    }
    if (result2.newOrders !== undefined) {
      unit.orders = result2.newOrders;
    }
    
    console.log('Unit after second move:', {
      position: { x: unit.x, y: unit.y },
      movementLeft: unit.movementLeft,
      orders: unit.orders
    });

    // Third movement attempt - should fail if no movement left
    console.log('\n=== Third Movement Attempt ===');
    const result3 = await actionSystem.executeAction(unit, ActionType.GOTO, 8, 5);
    
    console.log('ActionSystem result:', {
      success: result3.success,
      message: result3.message,
      newPosition: result3.newPosition,
      newMovementLeft: result3.newMovementLeft,
      movementCost: result3.movementCost
    });

  } catch (error) {
    console.error('Error during movement test:', error);
  }
}

testMovement().catch(console.error);