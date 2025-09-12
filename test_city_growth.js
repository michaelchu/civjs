// Quick test to check city growth mechanics
const { DatabaseProvider } = require('./apps/server/dist/database/index.js');
const { CityManager } = require('./apps/server/dist/game/managers/CityManager.js');
const { EffectsManager } = require('./apps/server/dist/game/managers/EffectsManager.js');

async function testCityGrowth() {
  console.log('Testing city growth mechanics...');
  
  // Create simple mocks
  const databaseProvider = {
    getDatabase: () => ({
      select: () => ({ from: () => ({ where: () => [] }) }),
      insert: () => ({ values: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      delete: () => ({ where: () => Promise.resolve() })
    })
  };
  
  const effectsManager = new EffectsManager();
  const cityManager = new CityManager('test-game', databaseProvider, effectsManager);
  
  // Initialize
  await cityManager.initialize();
  
  // Create a test city with food surplus
  const city = {
    id: 'test-city',
    name: 'TestCity',
    x: 10,
    y: 10,
    playerId: 'test-player',
    population: 1,
    size: 1,
    cityRadius: 2,
    founded: 1,
    currentProduction: 'warrior',
    productionType: 'unit',
    turnsToComplete: 10,
    productionStock: 0,
    foodStock: 15, // Close to growth threshold
    foodPerTurn: 3, // Positive surplus
    productionPerTurn: 2,
    tradePerTurn: 1,
    sciencePerTurn: 1,
    buildings: [],
    specialists: {
      0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0
    },
    tradeRoutes: [],
    happiness: { happy: 0, content: 1, unhappy: 0, angry: 0 },
    worklist: [],
    defenseStrength: 1,
    workableTiles: [
      { x: 10, y: 10, isCenter: true, isWorked: true, outputs: { food: 2, shields: 1, trade: 1 } }
    ]
  };
  
  // Add city to manager
  cityManager.cities.set(city.id, city);
  
  console.log('Before growth:');
  console.log(`Population: ${city.population}, Food Stock: ${city.foodStock}, Food Per Turn: ${city.foodPerTurn}`);
  
  // Calculate granary size
  const granarySize = cityManager.calculateGranarySize(city.population);
  console.log(`Granary size needed: ${granarySize}`);
  
  // Simulate turn processing
  try {
    await cityManager.processCityTurn(city.id, 2);
    
    console.log('After turn processing:');
    const updatedCity = cityManager.getCity(city.id);
    console.log(`Population: ${updatedCity.population}, Food Stock: ${updatedCity.foodStock}, Food Per Turn: ${updatedCity.foodPerTurn}`);
    
    if (updatedCity.population > city.population) {
      console.log('✅ City grew successfully!');
    } else {
      console.log('❌ City did not grow as expected');
    }
  } catch (error) {
    console.error('Error processing turn:', error.message);
  }
}

testCityGrowth().catch(console.error);