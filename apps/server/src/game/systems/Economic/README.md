# Economic System

The Economic System handles all gold-related mechanics in CivJS, including tax rate allocation, treasury management, and economic turn processing.

## Overview

This system implements the core Freeciv economic mechanics:
- **Tax Rate Management**: Players allocate trade between gold, luxury, and science
- **Treasury Operations**: Gold accumulation, spending, and transaction tracking
- **Turn Processing**: Economic calculations each turn
- **Rush Building**: Spending gold to instantly complete city productions

## Architecture

### EconomicManager
Main orchestrator that coordinates all economic operations. Does not contain business logic - delegates to specialized services.

### Services

#### TaxRateService
- Validates and manages tax rate changes
- Converts trade points to gold/luxury/science based on rates
- Provides tax rate recommendations
- Handles rate optimization and locks

#### TreasuryService
- Manages player gold accumulation and spending
- Processes turn-by-turn economic changes
- Handles rush building calculations and purchases
- Tracks transaction history and economic warnings

## Integration with Existing Systems

### CityManager Integration
```typescript
// Calculate city economic output
const economicOutput = economicManager.calculateCityEconomicOutput(
  cityId,
  playerId,
  cityTradeOutput,
  directGold,
  buildingUpkeep,
  unitUpkeep
);
```

### TurnManager Integration
```typescript
// Process player economics each turn
const economicSummary = await economicManager.processTurnEconomics(
  playerId,
  cityOutputs,
  currentTurn
);
```

## Usage Examples

### Initialize Player Economics
```typescript
// Set up new player with starting gold and tax rates
await economicManager.initializePlayer(
  playerId,
  50, // starting gold
  { tax: 50, luxury: 20, science: 30 }
);
```

### Change Tax Rates
```typescript
// Player adjusts tax allocation
const validation = economicManager.setPlayerTaxRates({
  playerId,
  newRates: { tax: 60, luxury: 20, science: 20 },
  immediate: true,
});

if (validation.isValid) {
  // Rates updated successfully
} else {
  // Show validation error
}
```

### Rush Building
```typescript
// Calculate rush cost
const rushCalc = await economicManager.getRushBuildingCalculation(
  playerId,
  cityId,
  'temple',
  20, // current progress
  60  // total cost
);

if (rushCalc.canAfford) {
  // Execute the rush purchase
  const result = await economicManager.executeRushBuilding(
    playerId,
    cityId,
    rushCalc
  );
}
```

### Economic Status
```typescript
// Get comprehensive economic overview
const status = await economicManager.getPlayerEconomicStatus(playerId);
console.log(`Gold: ${status.currentGold}`);
console.log(`Tax rates: ${status.taxRates.tax}%/${status.taxRates.luxury}%/${status.taxRates.science}%`);
console.log(`Warnings: ${status.warnings.length}`);
```

## Database Schema Requirements

The system requires these additional fields in the players table:

```sql
ALTER TABLE players ADD COLUMN tax_rate INTEGER DEFAULT 50;
ALTER TABLE players ADD COLUMN luxury_rate INTEGER DEFAULT 20;
ALTER TABLE players ADD COLUMN science_rate INTEGER DEFAULT 30;
```

## Configuration

Economic balance can be tuned via constants in `EconomicConstants.ts`:

- **DEFAULT_TAX_RATES**: Starting tax allocation
- **BUILDING_UPKEEP_COSTS**: Gold cost per turn for buildings
- **RUSH_BUILDING_MULTIPLIERS**: Cost multipliers for rush purchases
- **ECONOMIC_THRESHOLDS**: Warning thresholds for low treasury, etc.

## Testing

The system includes comprehensive unit tests:

```bash
# Run economic system tests
npm test -- Economic

# Test specific service
npm test -- TaxRateService
npm test -- TreasuryService
```

## Performance Considerations

- Tax rate calculations are performed in-memory for speed
- Transaction history is limited to 100 entries per player
- Economic warnings are cached and updated only during turn processing
- Database updates for gold are batched where possible

## Future Enhancements

### Planned Features
- **Corruption System**: Distance-based trade reduction
- **Building Sales**: Sell buildings for immediate gold
- **Economic Advisor**: AI recommendations for optimal play
- **Trade Route Economics**: Enhanced trade route gold calculations

### Extension Points
The system is designed for easy extension:
- Add new GoldSpendingType enum values
- Implement UpkeepService for building/unit costs
- Create CorruptionService for advanced mechanics
- Add EconomicAdviserService for AI recommendations

## Freeciv Compatibility

This implementation follows Freeciv mechanics closely:
- Tax rates in 10% increments summing to 100%
- Trade → Gold conversion at 1:1 ratio
- Rush building cost calculation matches freeciv formulas
- Building upkeep costs match classic ruleset values

## Error Handling

The system includes robust error handling:
- Database transaction failures are logged and recovered
- Invalid tax rates are rejected with detailed error messages
- Insufficient gold transactions are prevented
- Economic warnings alert players to potential issues

## Logging

Economic operations are logged for debugging:
- Tax rate changes
- Gold transactions
- Turn processing results
- Economic warnings and recommendations

Use log level DEBUG to see detailed economic calculations during development.