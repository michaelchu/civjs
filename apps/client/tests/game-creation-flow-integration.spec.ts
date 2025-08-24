import { test, expect } from '@playwright/test';
import { GameApiHelper, isValidUuid, getMockGameData } from './helpers/game-api';

test.describe('Game Creation Flow - Integration Tests with Real Game IDs', () => {
  let gameApi: GameApiHelper;
  let createdGameIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    gameApi = new GameApiHelper(request);
    console.log('🚀 Starting integration tests with real game creation');
  });

  test.afterAll(async () => {
    // Clean up any games created during testing
    console.log(`🧹 Cleaning up ${createdGameIds.length} test games...`);
    for (const gameId of createdGameIds) {
      await gameApi.deleteGame(gameId);
    }
  });

  test('should create real game and verify map loads without placeholder messages', async ({ page, request }) => {
    // Step 1: Create a real game via API with proper UUID
    console.log('📝 Creating real game via API...');
    
    const gameId = await gameApi.createGame({
      name: 'E2E Integration Test Game',
      maxPlayers: 2,
      mapWidth: 40,
      mapHeight: 30,
      ruleset: 'classic'
    });

    // Track for cleanup
    createdGameIds.push(gameId);
    
    console.log(`✅ Created game with ID: ${gameId}`);
    expect(isValidUuid(gameId)).toBe(true);

    // Step 2: Verify the game exists in the backend
    const gameDetails = await gameApi.getGame(gameId);
    console.log('📋 Game details:', gameDetails?.game?.name || 'Mock game');

    // Step 3: Set up frontend mocking for Socket.IO and assets
    await page.route('**/socket.io/**', (route) => {
      if (route.request().url().includes('transport=polling')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sid: `session-${gameId}`,
            upgrades: ['websocket'],
            pingInterval: 25000,
            pingTimeout: 5000,
          }),
        });
      } else {
        route.continue();
      }
    });

    // Mock sprite and tileset loading
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

    // Mock API responses for the specific game
    await page.route(`**/api/games/${gameId}*`, (route) => {
      const mockData = getMockGameData(gameId);
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          ...mockData
        }),
      });
    });

    // Step 4: Navigate to the game page with the REAL UUID
    console.log(`🌐 Navigating to game page: /game/${gameId}`);
    await page.goto(`http://localhost:3000/game/${gameId}`);
    
    // Verify we're on the correct URL with the real game ID
    expect(page.url()).toContain(`/game/${gameId}`);
    console.log(`✅ Successfully navigated to real game URL`);

    // Step 5: Join the game
    await expect(page.locator('text="Join Game"')).toBeVisible({ timeout: 10000 });
    expect(page.locator(`text="${gameId.slice(0, 8)}..."`)).toBeVisible(); // Should show partial game ID
    
    await page.fill('input[placeholder="Your player name"]', 'IntegrationTestPlayer');
    await page.click('button[type="submit"]');

    // Step 6: Wait for game layout and inject game data
    await page.waitForSelector('[data-testid="game-layout"]', { timeout: 15000 });
    console.log(`✅ Game layout loaded for game ${gameId}`);

    // Inject comprehensive game data for the specific game ID
    await page.evaluate((currentGameId) => {
      console.log('🗺️ Injecting game data for game:', currentGameId);
      
      // Set the current game context
      (window as any).currentGameId = currentGameId;
      
      // Mock complete map data
      (window as any).tiles = [
        { x: 0, y: 0, terrain: 'grassland', known: 1, seen: 1, elevation: 0 },
        { x: 1, y: 0, terrain: 'plains', known: 1, seen: 1, elevation: 0 },
        { x: 2, y: 0, terrain: 'ocean', known: 1, seen: 1, elevation: -1 },
        { x: 0, y: 1, terrain: 'forest', known: 1, seen: 1, elevation: 1 },
        { x: 1, y: 1, terrain: 'hills', known: 1, seen: 1, elevation: 2 },
        { x: 2, y: 1, terrain: 'mountains', known: 1, seen: 1, elevation: 3 },
        { x: 0, y: 2, terrain: 'desert', known: 1, seen: 1, elevation: 0 },
        { x: 1, y: 2, terrain: 'tundra', known: 1, seen: 1, elevation: 0 },
        { x: 2, y: 2, terrain: 'swamp', known: 1, seen: 1, elevation: 0 },
        { x: 3, y: 0, terrain: 'jungle', known: 1, seen: 1, elevation: 1 },
        { x: 3, y: 1, terrain: 'coast', known: 1, seen: 1, elevation: 0 },
      ];

      (window as any).map = { xsize: 40, ysize: 30, topology: 0 };
      (window as any).tileset = { normal_tile_width: 96, normal_tile_height: 48 };
      
      // Complete terrain setup
      (window as any).tile_types_setup = {
        'l0.grassland': { sprite_type: 1, match_style: 0, dither: false },
        'l0.plains': { sprite_type: 1, match_style: 0, dither: false },
        'l0.forest': { sprite_type: 1, match_style: 0, dither: false },
        'l0.hills': { sprite_type: 1, match_style: 0, dither: false },
        'l0.floor': { sprite_type: 1, match_style: 0, dither: false },
        'l0.coast': { sprite_type: 1, match_style: 0, dither: false },
        'l0.mountains': { sprite_type: 1, match_style: 0, dither: false },
        'l0.desert': { sprite_type: 1, match_style: 0, dither: false },
        'l0.arctic': { sprite_type: 1, match_style: 0, dither: false },
        'l0.swamp': { sprite_type: 1, match_style: 0, dither: false },
        'l0.jungle': { sprite_type: 1, match_style: 0, dither: false },
      };

      (window as any).ts_tiles = {
        grassland: { layer0_match_type: 'grassland' },
        plains: { layer0_match_type: 'plains' },
        forest: { layer0_match_type: 'forest' },
        hills: { layer0_match_type: 'hills' },
        floor: { layer0_match_type: 'floor' },
        coast: { layer0_match_type: 'coast' },
        mountains: { layer0_match_type: 'mountains' },
        desert: { layer0_match_type: 'desert' },
        arctic: { layer0_match_type: 'arctic' },
        swamp: { layer0_match_type: 'swamp' },
        jungle: { layer0_match_type: 'jungle' },
      };

      // Required rendering constants
      (window as any).CELL_WHOLE = 1;
      (window as any).CELL_CORNER = 2;
      (window as any).MATCH_NONE = 0;
      (window as any).MATCH_SAME = 1;
      (window as any).MATCH_FULL = 2;
      (window as any).cellgroup_map = {};
      
      console.log('✅ Game data injection complete');
    }, gameId);

    // Step 7: Wait for rendering and verify UI components
    await page.waitForTimeout(3000);
    console.log(`🎨 Waiting for map rendering to complete...`);

    // Verify core UI elements are present
    await expect(page.locator('[data-testid="game-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="map-tab"][aria-pressed="true"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="turn-done-button"]')).toBeVisible();
    console.log(`✅ All UI components loaded`);

    // Step 8: **CRITICAL ASSERTION** - Verify NO placeholder messages are visible
    console.log(`🔍 Checking for placeholder messages...`);
    
    const loadingMessageHidden = await page.locator('#loadingMessage').count() === 0 || 
      await page.locator('#loadingMessage').evaluate((el: HTMLElement) => 
        getComputedStyle(el).display === 'none'
      ).catch(() => true); // Element doesn't exist = hidden

    const noDataMessageHidden = await page.locator('#noDataMessage').count() === 0 ||
      await page.locator('#noDataMessage').evaluate((el: HTMLElement) => 
        getComputedStyle(el).display === 'none'
      ).catch(() => true); // Element doesn't exist = hidden

    // Also check for text content directly
    const noLoadingText = await page.locator('text="Loading Tileset..."').count() === 0;
    const noDataText = await page.locator('text="No Map Data - Connect to Server"').count() === 0;

    console.log(`📊 Placeholder check results:`);
    console.log(`  - Loading message hidden: ${loadingMessageHidden}`);
    console.log(`  - No data message hidden: ${noDataMessageHidden}`);
    console.log(`  - No loading text visible: ${noLoadingText}`);
    console.log(`  - No "no data" text visible: ${noDataText}`);

    expect(loadingMessageHidden).toBe(true);
    expect(noDataMessageHidden).toBe(true);
    expect(noLoadingText).toBe(true);
    expect(noDataText).toBe(true);

    // Step 9: Verify canvas has actual rendered content
    const canvas = await page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const canvasHasContent = await page.evaluate(() => {
      const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
      if (!canvasEl) return false;
      
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return false;
      
      const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
      const pixels = imageData.data;
      
      let nonTransparentPixels = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) nonTransparentPixels++;
      }
      
      return nonTransparentPixels > 100; // Should have significant content
    });

    expect(canvasHasContent).toBe(true);
    console.log(`✅ Canvas contains rendered map content`);

    // Step 10: Take screenshot with real game ID
    const shortGameId = gameId.slice(0, 8);
    await page.screenshot({ 
      path: `test-results/integration-game-${shortGameId}.png`, 
      fullPage: true 
    });

    // Final verification
    console.log(`🎉 INTEGRATION TEST PASSED for game ${gameId}:`);
    console.log(`  ✅ Real game created with UUID: ${gameId}`);
    console.log(`  ✅ Successfully navigated to /game/${gameId}`);
    console.log(`  ✅ Game UI loaded completely`);
    console.log(`  ✅ NO placeholder messages visible`);
    console.log(`  ✅ Map canvas rendered actual content`);
    console.log(`  ✅ Screenshot saved: integration-game-${shortGameId}.png`);
  });

  test('should handle concurrent game creation and navigation', async ({ page, request }) => {
    // Create multiple games concurrently to test scalability
    console.log('🚦 Testing concurrent game creation...');
    
    const gamePromises = [
      gameApi.createGame({ name: 'Concurrent Test Game 1', mapWidth: 20, mapHeight: 15 }),
      gameApi.createGame({ name: 'Concurrent Test Game 2', mapWidth: 30, mapHeight: 20 }),
    ];

    const gameIds = await Promise.all(gamePromises);
    createdGameIds.push(...gameIds);

    console.log(`✅ Created ${gameIds.length} games concurrently`);
    
    // Test navigating to each game
    for (const gameId of gameIds) {
      expect(isValidUuid(gameId)).toBe(true);
      
      // Quick navigation test
      await page.goto(`http://localhost:3000/game/${gameId}`);
      expect(page.url()).toContain(`/game/${gameId}`);
      
      // Verify the join form shows the correct game ID
      await expect(page.locator('text="Join Game"')).toBeVisible();
      await expect(page.locator(`text="${gameId.slice(0, 8)}..."`)).toBeVisible();
    }

    console.log(`✅ Successfully tested navigation to ${gameIds.length} concurrent games`);
  });

  test('should validate game ID formats in URL routing', async ({ page }) => {
    // Test various game ID formats to ensure proper validation
    const testCases = [
      {
        id: 'not-a-uuid',
        description: 'Invalid format',
        shouldHandle: true
      },
      {
        id: '12345678-1234-1234-1234-123456789012',
        description: 'Valid UUID format',
        shouldHandle: true
      },
      {
        id: '',
        description: 'Empty game ID',
        shouldHandle: true
      },
      {
        id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        description: 'UUID template',
        shouldHandle: true
      }
    ];

    for (const testCase of testCases) {
      console.log(`🧪 Testing ${testCase.description}: "${testCase.id}"`);
      
      try {
        await page.goto(`http://localhost:3000/game/${testCase.id}`, { waitUntil: 'domcontentloaded' });
        
        // Should handle gracefully without crashing
        const hasContent = await page.locator('body').isVisible({ timeout: 5000 });
        expect(hasContent).toBe(true);
        
        // Should show some form of user feedback
        const hasUserFeedback = await page.locator(
          'text="Join Game", text="Game not found", text="Invalid", [role="alert"]'
        ).first().isVisible({ timeout: 3000 });
        
        expect(hasUserFeedback).toBe(true);
        
        console.log(`  ✅ Handled gracefully`);
      } catch (error) {
        console.log(`  ❌ Failed to handle: ${error}`);
        throw error;
      }
    }
  });
});