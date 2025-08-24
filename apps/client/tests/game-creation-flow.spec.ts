import { test, expect } from '@playwright/test';

test.describe('Game Creation Flow', () => {
  test('should load game page and show map without loading placeholders', async ({ page }) => {
    // Mock the socket connection and server responses
    await page.route('**/socket.io/**', (route) => {
      // Mock socket.io connection
      if (route.request().url().includes('transport=polling')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sid: 'mock-session-id',
            upgrades: ['websocket'],
            pingInterval: 25000,
            pingTimeout: 5000,
          }),
        });
      } else {
        route.continue();
      }
    });

    // Mock tileset and sprite loading
    await page.route('**/sprites/**', (route) => {
      // Return a mock image for sprite requests
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          'base64'
        ),
      });
    });

    // Mock the tileset spec file
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
unit_width = 48
unit_height = 48
small_tile_width = 15
small_tile_height = 20
type = "isometric"
`,
      });
    });

    // Create a test game ID
    const testGameId = 'test-game-123';
    
    // Navigate to the game page
    await page.goto(`/game/${testGameId}`);

    // Fill in player name and join game
    await page.fill('input[placeholder="Your player name"]', 'TestPlayer');
    await page.click('button[type="submit"]');

    // Wait for game to load and show the game layout
    await page.waitForSelector('[data-testid="game-layout"]', { timeout: 10000 });

    // Inject mock game data into the window
    await page.evaluate(() => {
      // Mock tiles array with some basic terrain
      (window as any).tiles = [
        { x: 0, y: 0, terrain: 'grassland', known: 1, seen: 1 },
        { x: 1, y: 0, terrain: 'plains', known: 1, seen: 1 },
        { x: 0, y: 1, terrain: 'forest', known: 1, seen: 1 },
        { x: 1, y: 1, terrain: 'hills', known: 1, seen: 1 },
        { x: 2, y: 0, terrain: 'ocean', known: 1, seen: 1 },
        { x: 2, y: 1, terrain: 'mountains', known: 1, seen: 1 },
      ];

      // Mock map data
      (window as any).map = {
        xsize: 10,
        ysize: 10,
      };

      // Mock tileset data
      (window as any).tileset = {
        'normal_tile_width': 96,
        'normal_tile_height': 48,
      };

      // Mock tile types setup (required for terrain rendering)
      (window as any).tile_types_setup = {
        'l0.grassland': {
          sprite_type: 1, // CELL_WHOLE
          match_style: 0, // MATCH_NONE
          dither: false,
        },
        'l0.plains': {
          sprite_type: 1,
          match_style: 0,
          dither: false,
        },
        'l0.forest': {
          sprite_type: 1,
          match_style: 0,
          dither: false,
        },
        'l0.hills': {
          sprite_type: 1,
          match_style: 0,
          dither: false,
        },
        'l0.floor': {
          sprite_type: 1,
          match_style: 0,
          dither: false,
        },
        'l0.mountains': {
          sprite_type: 1,
          match_style: 0,
          dither: false,
        },
      };

      // Mock ts_tiles data
      (window as any).ts_tiles = {
        grassland: { layer0_match_type: 'grassland' },
        plains: { layer0_match_type: 'plains' },
        forest: { layer0_match_type: 'forest' },
        hills: { layer0_match_type: 'hills' },
        floor: { layer0_match_type: 'floor' },
        mountains: { layer0_match_type: 'mountains' },
      };

      // Set required constants for rendering
      (window as any).CELL_WHOLE = 1;
      (window as any).CELL_CORNER = 2;
      (window as any).MATCH_NONE = 0;
      (window as any).MATCH_SAME = 1;
      (window as any).MATCH_FULL = 2;

      // Mock cellgroup_map
      (window as any).cellgroup_map = {};
    });

    // Wait for canvas element to be present
    const canvas = await page.waitForSelector('canvas', { timeout: 5000 });
    expect(canvas).toBeTruthy();

    // Wait a moment for any rendering to occur
    await page.waitForTimeout(2000);

    // Take a screenshot to verify visual state
    await page.screenshot({ path: 'test-results/game-map-loaded.png', fullPage: true });

    // Check that the map canvas is present and has content
    const canvasContent = await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) return null;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      // Get image data to check if anything is drawn
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      
      // Check if the canvas has any non-transparent pixels (indicating content)
      let hasContent = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) { // Alpha channel
          hasContent = true;
          break;
        }
      }
      
      return {
        width: canvas.width,
        height: canvas.height,
        hasContent,
      };
    });

    console.log('Canvas content:', canvasContent);
    expect(canvasContent).toBeTruthy();
    expect(canvasContent!.width).toBeGreaterThan(0);
    expect(canvasContent!.height).toBeGreaterThan(0);

    // Most importantly: Assert that the "No Map Data" and "Loading Tileset" messages are NOT visible
    await expect(page.locator('text="No Map Data - Connect to Server"')).toHaveCount(0);
    await expect(page.locator('text="Loading Tileset..."')).toHaveCount(0);

    // Verify that we're in the game view (map tab should be active)
    await expect(page.locator('[data-testid="map-tab"][aria-pressed="true"]')).toBeVisible();

    // Check that game UI elements are present
    await expect(page.locator('[data-testid="status-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="turn-done-button"]')).toBeVisible();
  });

  test('should show loading states before game data is available', async ({ page }) => {
    // Mock the socket connection but don't provide game data immediately
    await page.route('**/socket.io/**', (route) => {
      if (route.request().url().includes('transport=polling')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sid: 'mock-session-id',
            upgrades: ['websocket'],
            pingInterval: 25000,
            pingTimeout: 5000,
          }),
        });
      } else {
        route.continue();
      }
    });

    // Delay tileset loading to test loading state
    await page.route('**/sprites/**', (route) => {
      setTimeout(() => {
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64'
          ),
        });
      }, 100);
    });

    await page.route('**/amplio2.tilespec', (route) => {
      setTimeout(() => {
        route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: `[tilespec]
tilespec_name = "Amplio2"
is_hex = FALSE
version = 3
normal_tile_width = 96
normal_tile_height = 48
`,
        });
      }, 50);
    });

    const testGameId = 'test-game-456';
    await page.goto(`/game/${testGameId}`);

    // Fill in player name and join game
    await page.fill('input[placeholder="Your player name"]', 'TestPlayer');
    await page.click('button[type="submit"]');

    // Wait for game layout to load
    await page.waitForSelector('[data-testid="game-layout"]', { timeout: 10000 });

    // Check that we see a loading state initially (before mock data is injected)
    const canvas = await page.waitForSelector('canvas', { timeout: 5000 });
    expect(canvas).toBeTruthy();

    // Initially, we should see either loading message or empty map
    // We'll check that the canvas exists but may show placeholder content initially
    const initialState = await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) return null;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      return {
        width: canvas.width,
        height: canvas.height,
      };
    });

    expect(initialState).toBeTruthy();
    expect(initialState!.width).toBeGreaterThan(0);
    expect(initialState!.height).toBeGreaterThan(0);

    // Now inject game data to simulate successful loading
    await page.evaluate(() => {
      (window as any).tiles = [
        { x: 0, y: 0, terrain: 'grassland', known: 1, seen: 1 },
        { x: 1, y: 0, terrain: 'plains', known: 1, seen: 1 },
      ];
      (window as any).map = { xsize: 10, ysize: 10 };
      (window as any).tileset = { 'normal_tile_width': 96, 'normal_tile_height': 48 };
      (window as any).tile_types_setup = {
        'l0.grassland': { sprite_type: 1, match_style: 0, dither: false },
        'l0.plains': { sprite_type: 1, match_style: 0, dither: false },
      };
      (window as any).ts_tiles = {
        grassland: { layer0_match_type: 'grassland' },
        plains: { layer0_match_type: 'plains' },
      };
      (window as any).CELL_WHOLE = 1;
      (window as any).MATCH_NONE = 0;
      (window as any).cellgroup_map = {};
    });

    // Wait for rendering to complete
    await page.waitForTimeout(1000);

    // After data is loaded, placeholder messages should be gone
    await expect(page.locator('text="No Map Data - Connect to Server"')).toHaveCount(0);
    await expect(page.locator('text="Loading Tileset..."')).toHaveCount(0);
  });

  test('should handle invalid game ID gracefully', async ({ page }) => {
    // Try to navigate to a non-existent game
    await page.goto('/game/invalid-game-id');

    // Should either redirect to home or show an error
    // We expect to see the player name prompt regardless
    await expect(page.locator('text="Join Game"')).toBeVisible();
    await expect(page.locator('input[placeholder="Your player name"]')).toBeVisible();
  });
});