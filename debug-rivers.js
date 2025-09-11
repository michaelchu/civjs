// Simple debug script for river generation
const { RiverGenerator } = require('./dist/src/game/map/RiverGenerator.js');

// Create a mock simple map for testing
const width = 20;
const height = 20;
const mockTiles = Array(width).fill().map(() => 
  Array(height).fill().map(() => ({
    terrain: 'grassland',
    elevation: Math.floor(Math.random() * 100),
    riverMask: 0
  }))
);

// Add some ocean around the edges
for (let x = 0; x < width; x++) {
  mockTiles[x][0].terrain = 'ocean';
  mockTiles[x][height-1].terrain = 'ocean';
}
for (let y = 0; y < height; y++) {
  mockTiles[0][y].terrain = 'ocean';
  mockTiles[width-1][y].terrain = 'ocean';
}

// Add some mountains in the center
for (let x = 8; x < 12; x++) {
  for (let y = 8; y < 12; y++) {
    mockTiles[x][y].terrain = 'mountains';
    mockTiles[x][y].elevation = 150 + Math.floor(Math.random() * 50);
  }
}

// Create river generator
const riverGen = new RiverGenerator(width, height, Math.random);

console.log('Testing river generation with simple debug...');

// Test river generation
riverGen.generateAdvancedRivers(mockTiles)
  .then(() => {
    console.log('River generation completed');
    
    // Count river tiles
    let riverCount = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (mockTiles[x][y].riverMask > 0) {
          riverCount++;
          console.log(`River tile at (${x}, ${y})`);
        }
      }
    }
    console.log(`Total river tiles: ${riverCount}`);
  })
  .catch(console.error);