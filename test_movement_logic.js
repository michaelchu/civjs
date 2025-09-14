// Simple test to verify movement logic without database dependencies
const { SINGLE_MOVE } = require('./apps/server/src/game/constants/MovementConstants');

// Mock unit with proper structure
function createTestUnit() {
  return {
    id: 'test-unit',
    playerId: 'player1', 
    unitTypeId: 'warriors',
    x: 10,
    y: 10,
    movementLeft: 3 * SINGLE_MOVE, // 3 movement points
    orders: [],
    fortified: false
  };
}

// Simulate ActionSystem.executeGoto logic
function simulateExecuteGoto(unit, targetX, targetY) {
  console.log('\n=== simulateExecuteGoto ===');
  console.log('Input:', { 
    position: {x: unit.x, y: unit.y}, 
    target: {x: targetX, y: targetY}, 
    movementLeft: unit.movementLeft 
  });

  // Validate movement
  if (unit.movementLeft <= 0) {
    return { success: false, message: 'No movement left' };
  }

  if (targetX === undefined || targetY === undefined) {
    return { success: false, message: 'Invalid target coordinates' };
  }

  // Calculate path (simple adjacent move)
  const dx = Math.abs(targetX - unit.x);
  const dy = Math.abs(targetY - unit.y);

  if (dx > 1 || dy > 1) {
    return { success: false, message: 'Target too far' };
  }

  // Calculate movement cost (diagonal = 1.5x, orthogonal = 1x)
  const movementCost = (dx === 1 && dy === 1) ? Math.floor(SINGLE_MOVE * 1.5) : SINGLE_MOVE;
  
  if (unit.movementLeft < movementCost) {
    return { success: false, message: 'Insufficient movement points' };
  }

  // Calculate new position and remaining movement
  const remainingMovement = unit.movementLeft - movementCost;
  
  console.log('Movement calculation:', {
    movementCost,
    remainingMovement,
    diagonal: dx === 1 && dy === 1
  });

  // Return result without mutating unit
  return {
    success: true,
    message: `Unit moved to (${targetX}, ${targetY})`,
    newPosition: { x: targetX, y: targetY },
    newMovementLeft: remainingMovement,
    newOrders: [],
    movementCost
  };
}

// Simulate UnitManager.handleGoto logic
function simulateHandleGoto(unit, result) {
  console.log('\n=== simulateHandleGoto ===');
  console.log('Before update:', { 
    position: {x: unit.x, y: unit.y}, 
    movementLeft: unit.movementLeft 
  });

  if (!result.newPosition) return {};

  // Apply changes from ActionSystem result
  unit.x = result.newPosition.x;
  unit.y = result.newPosition.y;

  if (result.newMovementLeft !== undefined) {
    unit.movementLeft = result.newMovementLeft;
  }

  if (result.newOrders !== undefined) {
    unit.orders = result.newOrders;
  }

  console.log('After update:', { 
    position: {x: unit.x, y: unit.y}, 
    movementLeft: unit.movementLeft 
  });

  return {
    x: unit.x,
    y: unit.y,
    movementPoints: unit.movementLeft.toString(),
    orders: JSON.stringify(unit.orders || [])
  };
}

// Test multiple moves
function testMultipleMoves() {
  console.log('=== Testing Multiple Moves ===');
  
  const unit = createTestUnit();
  console.log('Initial state:', { 
    position: {x: unit.x, y: unit.y}, 
    movementLeft: unit.movementLeft 
  });

  // Move 1: Right one tile
  console.log('\n--- Move 1: (10,10) -> (11,10) ---');
  let result = simulateExecuteGoto(unit, 11, 10);
  console.log('Action result:', result);
  
  if (result.success) {
    simulateHandleGoto(unit, result);
  } else {
    console.log('Move 1 FAILED:', result.message);
    return;
  }

  // Move 2: Right one more tile
  console.log('\n--- Move 2: (11,10) -> (12,10) ---');
  result = simulateExecuteGoto(unit, 12, 10);
  console.log('Action result:', result);
  
  if (result.success) {
    simulateHandleGoto(unit, result);
  } else {
    console.log('Move 2 FAILED:', result.message);
    return;
  }

  // Move 3: Down one tile (diagonal)
  console.log('\n--- Move 3: (12,10) -> (12,11) ---');
  result = simulateExecuteGoto(unit, 12, 11);
  console.log('Action result:', result);
  
  if (result.success) {
    simulateHandleGoto(unit, result);
  } else {
    console.log('Move 3 FAILED:', result.message);
    return;
  }

  // Move 4: Should fail (not enough movement)
  console.log('\n--- Move 4: (12,11) -> (13,11) (should fail) ---');
  result = simulateExecuteGoto(unit, 13, 11);
  console.log('Action result:', result);
  
  if (result.success) {
    simulateHandleGoto(unit, result);
  } else {
    console.log('Move 4 FAILED (expected):', result.message);
  }

  console.log('\nFinal unit state:', { 
    position: {x: unit.x, y: unit.y}, 
    movementLeft: unit.movementLeft 
  });
}

// Test settler specific issues
function testSettlerMovement() {
  console.log('\n=== Testing Settler Movement ===');
  
  const settler = {
    id: 'test-settler',
    playerId: 'player1', 
    unitTypeId: 'settlers', // Note: using 'settlers' (plural)
    x: 5,
    y: 5,
    movementLeft: 1 * SINGLE_MOVE, // 1 movement point (typical for settlers)
    orders: [],
    fortified: false
  };

  console.log('Initial settler state:', { 
    position: {x: settler.x, y: settler.y}, 
    movementLeft: settler.movementLeft,
    unitType: settler.unitTypeId
  });

  // Move settler one tile
  console.log('\n--- Settler Move: (5,5) -> (6,5) ---');
  const result = simulateExecuteGoto(settler, 6, 5);
  console.log('Action result:', result);
  
  if (result.success) {
    simulateHandleGoto(settler, result);
    console.log('Settler moved successfully');
  } else {
    console.log('Settler FAILED to move:', result.message);
  }
}

// Run tests
console.log('SINGLE_MOVE constant:', SINGLE_MOVE);
testMultipleMoves();
testSettlerMovement();