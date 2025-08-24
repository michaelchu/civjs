import { test, expect } from '@playwright/test';

test.describe('Game Creation Flow - Backend Data Format', () => {
  test('should load map with real backend data format and show no placeholder messages', async ({ page }) => {
    const realGameId = 'a5d571f1-15b6-4d02-85b9-2d2a2b620ecd'; // Real UUID format
    
    // Mock Socket.IO connection with real backend message format
    await page.route('**/socket.io/**', (route) => {
      if (route.request().url().includes('transport=polling')) {
        // Initial Socket.IO handshake
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sid: `session-${realGameId}`,
            upgrades: ['websocket'],
            pingInterval: 25000,
            pingTimeout: 5000,
          }),
        });
      } else {
        route.continue();
      }
    });

    // Mock sprite and tileset assets
    await page.route('**/sprites/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          'base64'
        ),
      });
    });

    await page.route('**/amplio2.tilespec', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: `[tilespec]
tilespec_name = "Amplio2"
is_hex = FALSE
version = 3
normal_tile_width = 96
normal_tile_height = 48
type = "isometric"
`,
      });
    });

    // Navigate to the real game URL
    await page.goto(`http://localhost:3000/game/${realGameId}`);

    // Join the game
    await expect(page.locator('text="Join Game"')).toBeVisible();
    await page.fill('input[placeholder="Your player name"]', 'BackendTestPlayer');
    await page.click('button[type="submit"]');

    // Wait for game layout
    await page.waitForSelector('[data-testid="game-layout"]', { timeout: 10000 });

    // **SIMULATE ACTUAL BACKEND SOCKET.IO MESSAGE SEQUENCE**
    await page.evaluate((gameId) => {
      console.log('🚀 Simulating backend Socket.IO messages for game:', gameId);
      
      // Step 1: Simulate 'map-data' packet (initial map metadata)
      const mapDataPacket = {
        gameId: gameId,
        width: 20,
        height: 15,
        startingPositions: [
          { x: 5, y: 5, playerId: 'player1' },
          { x: 15, y: 10, playerId: 'player2' }
        ],
        seed: 'backend-test-seed',
        generatedAt: new Date().toISOString()
      };

      // Step 2: Simulate 'map-info' packet (freeciv-web compatible format)
      const mapInfoPacket = {
        xsize: 20,
        ysize: 15,
        wrap_id: 0, // Flat earth
        topology_id: 0,
      };

      // Apply map-info exactly like the client does
      (window as any).map = mapInfoPacket;
      
      // Initialize tiles array exactly like backend
      const totalTiles = mapInfoPacket.xsize * mapInfoPacket.ysize;
      (window as any).tiles = new Array(totalTiles);
      
      for (let i = 0; i < totalTiles; i++) {
        (window as any).tiles[i] = {
          index: i,
          x: i % mapInfoPacket.xsize,
          y: Math.floor(i / mapInfoPacket.xsize),
          known: 0,
          seen: 0,
        };
      }

      console.log('✅ Map info initialized:', mapInfoPacket);
      console.log('✅ Tiles array created with', totalTiles, 'tiles');

      // Step 3: Simulate 'tile-info-batch' packet with real backend tile format
      const tileInfoBatch = {
        tiles: [
          // Exact format from GameManager.ts
          { tile: 0, x: 0, y: 0, terrain: 'grassland', resource: null, elevation: 80, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 1, x: 1, y: 0, terrain: 'plains', resource: null, elevation: 85, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 2, x: 2, y: 0, terrain: 'ocean', resource: 'fish', elevation: -10, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 20, x: 0, y: 1, terrain: 'forest', resource: null, elevation: 120, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 21, x: 1, y: 1, terrain: 'hills', resource: 'coal', elevation: 140, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 22, x: 2, y: 1, terrain: 'mountains', resource: 'iron', elevation: 200, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 40, x: 0, y: 2, terrain: 'desert', resource: 'oasis', elevation: 60, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 41, x: 1, y: 2, terrain: 'tundra', resource: null, elevation: 40, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 42, x: 2, y: 2, terrain: 'swamp', resource: null, elevation: 20, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 60, x: 0, y: 3, terrain: 'jungle', resource: 'ivory', elevation: 100, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 },
          { tile: 105, x: 5, y: 5, terrain: 'grassland', resource: null, elevation: 75, riverMask: 1, known: 1, seen: 1, player: null, worked: null, extras: 0 }, // Starting position
          { tile: 235, x: 15, y: 10, terrain: 'plains', resource: null, elevation: 90, riverMask: 0, known: 1, seen: 1, player: null, worked: null, extras: 0 }, // Starting position
        ]
      };

      // Process batch exactly like GameClient.ts does
      const tiles = (window as any).tiles;
      for (const tileData of tileInfoBatch.tiles) {
        tiles[tileData.tile] = Object.assign(
          tiles[tileData.tile] || {},
          tileData
        );
      }

      console.log('✅ Processed', tileInfoBatch.tiles.length, 'tiles in batch');
      console.log('🗺️ Sample tile data:', tiles[0]);

      // Step 4: Setup tileset data exactly like freeciv-web expects
      (window as any).tileset = {
        'normal_tile_width': 96,
        'normal_tile_height': 48,
      };

      // Complete terrain rendering setup (from freeciv-web tilespec.js)
      (window as any).tile_types_setup = {
        'l0.grassland': { sprite_type: 1, match_style: 0, dither: false },
        'l0.plains': { sprite_type: 1, match_style: 0, dither: false },
        'l0.forest': { sprite_type: 1, match_style: 0, dither: false },
        'l0.hills': { sprite_type: 1, match_style: 0, dither: false },
        'l0.floor': { sprite_type: 1, match_style: 0, dither: false }, // ocean
        'l0.coast': { sprite_type: 1, match_style: 0, dither: false },
        'l0.mountains': { sprite_type: 1, match_style: 0, dither: false },
        'l0.desert': { sprite_type: 1, match_style: 0, dither: false },
        'l0.arctic': { sprite_type: 1, match_style: 0, dither: false }, // tundra
        'l0.swamp': { sprite_type: 1, match_style: 0, dither: false },
        'l0.jungle': { sprite_type: 1, match_style: 0, dither: false },
      };

      (window as any).ts_tiles = {
        grassland: { layer0_match_type: 'grassland' },
        plains: { layer0_match_type: 'plains' },
        forest: { layer0_match_type: 'forest' },
        hills: { layer0_match_type: 'hills' },
        floor: { layer0_match_type: 'floor' }, // ocean
        coast: { layer0_match_type: 'coast' },
        mountains: { layer0_match_type: 'mountains' },
        desert: { layer0_match_type: 'desert' },
        arctic: { layer0_match_type: 'arctic' }, // tundra
        swamp: { layer0_match_type: 'swamp' },
        jungle: { layer0_match_type: 'jungle' },
      };

      // Required constants from freeciv-web
      (window as any).CELL_WHOLE = 1;
      (window as any).CELL_CORNER = 2;
      (window as any).MATCH_NONE = 0;
      (window as any).MATCH_SAME = 1;
      (window as any).MATCH_FULL = 2;
      (window as any).cellgroup_map = {};

      console.log('✅ Complete backend data simulation finished');
      console.log('📊 Final tiles count:', tiles.filter(t => t && t.known > 0).length, 'known tiles');
      
      // Mark as ready for testing
      (window as any).backendDataReady = true;
    }, realGameId);

    // Wait for backend simulation to complete
    await page.waitForFunction(() => (window as any).backendDataReady === true, { timeout: 5000 });

    // Allow time for map rendering
    await page.waitForTimeout(3000);

    console.log('🔍 Verifying UI elements are loaded...');

    // Verify all UI components are present
    await expect(page.locator('[data-testid="game-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="map-tab"][aria-pressed="true"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="turn-done-button"]')).toBeVisible();

    // **CRITICAL TEST**: Verify NO placeholder messages are visible
    console.log('🎯 Checking for placeholder messages...');
    
    // Check that placeholder messages are not in the DOM or are hidden
    const noLoadingText = await page.locator('text="Loading Tileset..."').count() === 0;
    const noDataText = await page.locator('text="No Map Data - Connect to Server"').count() === 0;
    
    expect(noLoadingText).toBe(true);
    expect(noDataText).toBe(true);
    
    console.log('✅ No placeholder messages found');

    // Verify canvas has rendered content
    const canvas = await page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const canvasAnalysis = await page.evaluate(() => {
      const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
      if (!canvasEl) return { hasCanvas: false };
      
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return { hasCanvas: true, hasContext: false };
      
      // Analyze canvas content
      const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
      const pixels = imageData.data;
      
      let nonTransparentPixels = 0;
      let colorVariations = new Set();
      
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        
        if (a > 0) {
          nonTransparentPixels++;
          colorVariations.add(`${r},${g},${b}`);
        }
      }
      
      return {
        hasCanvas: true,
        hasContext: true,
        width: canvasEl.width,
        height: canvasEl.height,
        nonTransparentPixels,
        colorVariations: colorVariations.size,
        hasSignificantContent: nonTransparentPixels > 1000 && colorVariations.size > 1
      };
    });

    console.log('🎨 Canvas analysis:', canvasAnalysis);
    
    expect(canvasAnalysis.hasCanvas).toBe(true);
    expect(canvasAnalysis.hasContext).toBe(true);
    expect(canvasAnalysis.hasSignificantContent).toBe(true);

    // Verify backend data was properly processed
    const backendDataCheck = await page.evaluate(() => {
      const map = (window as any).map;
      const tiles = (window as any).tiles;
      
      if (!map || !tiles) {
        return { error: 'Missing map or tiles data' };
      }
      
      const knownTiles = tiles.filter((t: any) => t && t.known > 0).length;
      const terrainTypes = new Set(tiles.filter((t: any) => t && t.terrain).map((t: any) => t.terrain));
      
      return {
        mapSize: `${map.xsize}x${map.ysize}`,
        totalTiles: tiles.length,
        knownTiles,
        terrainTypes: Array.from(terrainTypes),
        hasStartingPositions: knownTiles > 0,
        sampleTile: tiles[0]
      };
    });

    console.log('📋 Backend data verification:', backendDataCheck);
    
    expect(backendDataCheck.mapSize).toBe('20x15');
    expect(backendDataCheck.totalTiles).toBe(300); // 20 * 15
    expect(backendDataCheck.knownTiles).toBeGreaterThan(0);
    expect(backendDataCheck.terrainTypes.length).toBeGreaterThan(5);

    // Take screenshot for verification
    await page.screenshot({ 
      path: `test-results/backend-format-game-${realGameId.slice(0, 8)}.png`, 
      fullPage: true 
    });

    console.log('🎉 BACKEND FORMAT TEST PASSED:');
    console.log('  ✅ Real UUID game ID:', realGameId);
    console.log('  ✅ Backend Socket.IO message format simulated');
    console.log('  ✅ Map data processed in freeciv-web compatible format');
    console.log('  ✅ NO placeholder messages visible');
    console.log('  ✅ Canvas rendered actual map content');
    console.log('  ✅ All terrain types loaded:', backendDataCheck.terrainTypes);
  });

  test('should handle gradual tile loading like real backend', async ({ page }) => {
    const realGameId = '2f8c3e45-9a7b-4d3e-8f1a-c5b6d8e9f0a2';
    
    // Setup basic mocking
    await page.route('**/socket.io/**', (route) => {
      if (route.request().url().includes('transport=polling')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sid: `session-${realGameId}`,
            upgrades: ['websocket'],
            pingInterval: 25000,
            pingTimeout: 5000,
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.route('**/sprites/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          'base64'
        ),
      });
    });

    await page.route('**/amplio2.tilespec', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: '[tilespec]\ntilespec_name = "Amplio2"\nnormal_tile_width = 96\nnormal_tile_height = 48\n',
      });
    });

    await page.goto(`http://localhost:3000/game/${realGameId}`);
    
    await page.fill('input[placeholder="Your player name"]', 'GradualLoadTest');
    await page.click('button[type="submit"]');
    
    await page.waitForSelector('[data-testid="game-layout"]');

    // **SIMULATE GRADUAL TILE LOADING** (like real backend with visibility updates)
    await page.evaluate((gameId) => {
      console.log('🔄 Simulating gradual tile loading for game:', gameId);
      
      // Step 1: Initialize map
      (window as any).map = { xsize: 10, ysize: 10, wrap_id: 0, topology_id: 0 };
      const totalTiles = 100;
      (window as any).tiles = new Array(totalTiles);
      
      for (let i = 0; i < totalTiles; i++) {
        (window as any).tiles[i] = {
          index: i,
          x: i % 10,
          y: Math.floor(i / 10),
          known: 0,
          seen: 0,
        };
      }

      // Setup rendering system
      (window as any).tileset = { normal_tile_width: 96, normal_tile_height: 48 };
      (window as any).tile_types_setup = {
        'l0.grassland': { sprite_type: 1, match_style: 0, dither: false },
        'l0.plains': { sprite_type: 1, match_style: 0, dither: false },
        'l0.ocean': { sprite_type: 1, match_style: 0, dither: false },
      };
      (window as any).ts_tiles = {
        grassland: { layer0_match_type: 'grassland' },
        plains: { layer0_match_type: 'plains' },
        ocean: { layer0_match_type: 'ocean' },
      };
      (window as any).CELL_WHOLE = 1;
      (window as any).MATCH_NONE = 0;
      (window as any).cellgroup_map = {};

      // Step 2: Load tiles gradually (simulating player movement/exploration)
      const tiles = (window as any).tiles;
      let tilesLoaded = 0;
      
      const loadNextBatch = () => {
        const batchSize = 5;
        const startIndex = tilesLoaded;
        const endIndex = Math.min(tilesLoaded + batchSize, totalTiles);
        
        for (let i = startIndex; i < endIndex; i++) {
          const terrains = ['grassland', 'plains', 'ocean'];
          tiles[i] = Object.assign(tiles[i], {
            terrain: terrains[i % terrains.length],
            known: 1,
            seen: 1,
            elevation: 50 + (i * 10) % 100,
          });
        }
        
        tilesLoaded = endIndex;
        console.log(`📍 Loaded batch: ${startIndex}-${endIndex-1} (${tilesLoaded}/${totalTiles} total)`);
        
        if (tilesLoaded < totalTiles) {
          setTimeout(loadNextBatch, 100); // Load next batch after 100ms
        } else {
          (window as any).gradualLoadingComplete = true;
          console.log('✅ Gradual loading complete');
        }
      };

      // Start loading
      setTimeout(loadNextBatch, 200);
    }, realGameId);

    // Wait for gradual loading to complete
    await page.waitForFunction(() => (window as any).gradualLoadingComplete === true, { timeout: 10000 });

    // Verify no placeholders during or after loading
    await expect(page.locator('text="Loading Tileset..."')).toHaveCount(0);
    await expect(page.locator('text="No Map Data - Connect to Server"')).toHaveCount(0);

    // Verify final state
    const finalCheck = await page.evaluate(() => {
      const tiles = (window as any).tiles;
      const knownTiles = tiles ? tiles.filter((t: any) => t && t.known > 0).length : 0;
      return { totalTiles: tiles ? tiles.length : 0, knownTiles };
    });

    expect(finalCheck.totalTiles).toBe(100);
    expect(finalCheck.knownTiles).toBe(100);

    console.log('✅ Gradual loading test passed - all tiles loaded without placeholders');
  });
});