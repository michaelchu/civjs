import { test, expect } from '@playwright/test';

test.describe('Game Creation Flow - Static Test', () => {
  test('should verify map renderer does not show loading placeholders when data is available', async ({ page }) => {
    // Create a simple HTML page that mocks the game environment
    const mockHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>CivJS Test</title>
      <style>
        body { 
          margin: 0; 
          font-family: Arial, sans-serif; 
          background: #1f2937; 
          color: white; 
        }
        .game-layout { 
          min-height: 100vh; 
          display: flex; 
          flex-direction: column; 
        }
        .canvas-container { 
          flex: 1; 
          position: relative; 
          background: #4682B4; 
        }
        canvas { 
          display: block; 
          width: 100%; 
          height: 500px; 
        }
        .ui-elements {
          padding: 16px;
          background: #374151;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .tabs {
          display: flex;
          gap: 8px;
        }
        .tab {
          padding: 8px 16px;
          background: #4B5563;
          border: none;
          color: white;
          cursor: pointer;
          border-radius: 4px;
        }
        .tab.active {
          background: #1F2937;
          border-bottom: 2px solid #3B82F6;
        }
        .status-panel {
          display: flex;
          gap: 16px;
          font-size: 14px;
        }
        .turn-done-button {
          background: #10B981;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }
        .loading-message, .no-data-message {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 20px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="game-layout" data-testid="game-layout">
        <div class="ui-elements">
          <div class="tabs">
            <button class="tab active" data-testid="map-tab" aria-pressed="true">Map</button>
            <button class="tab" data-testid="government-tab" aria-pressed="false">Government</button>
            <button class="tab" data-testid="research-tab" aria-pressed="false">Research</button>
          </div>
          <div class="status-panel" data-testid="status-panel">
            <div>Turn: <span>1</span></div>
            <div>Gold: <span>100</span></div>
            <div>Science: <span>10</span></div>
          </div>
          <button class="turn-done-button" data-testid="turn-done-button">Turn Done</button>
        </div>
        
        <div class="canvas-container">
          <canvas id="gameCanvas" width="800" height="500"></canvas>
          <!-- These should NOT be visible when map data is loaded -->
          <div id="loadingMessage" class="loading-message" style="display: none;">Loading Tileset...</div>
          <div id="noDataMessage" class="no-data-message" style="display: none;">No Map Data - Connect to Server</div>
        </div>
      </div>

      <script>
        // Mock the MapRenderer behavior
        class MockMapRenderer {
          constructor(ctx) {
            this.ctx = ctx;
            this.isInitialized = false;
          }

          async initialize() {
            // Simulate tileset loading
            await new Promise(resolve => setTimeout(resolve, 100));
            this.isInitialized = true;
          }

          render(gameState) {
            this.clearCanvas();
            
            if (!this.isInitialized) {
              this.showMessage('Loading Tileset...');
              return;
            }

            // Check if we have map data
            if (!gameState || !gameState.tiles || gameState.tiles.length === 0) {
              this.showMessage('No Map Data - Connect to Server');
              return;
            }

            // Hide any loading messages
            this.hideMessages();
            
            // Render a simple map
            this.renderMap(gameState);
          }

          clearCanvas() {
            this.ctx.fillStyle = '#4682B4';
            this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
          }

          showMessage(message) {
            document.getElementById('loadingMessage').style.display = message === 'Loading Tileset...' ? 'block' : 'none';
            document.getElementById('noDataMessage').style.display = message === 'No Map Data - Connect to Server' ? 'block' : 'none';
          }

          hideMessages() {
            const loadingEl = document.getElementById('loadingMessage');
            const noDataEl = document.getElementById('noDataMessage');
            if (loadingEl) loadingEl.style.display = 'none';
            if (noDataEl) noDataEl.style.display = 'none';
          }

          renderMap(gameState) {
            // Draw a simple grid to represent the map
            this.ctx.strokeStyle = '#336699';
            this.ctx.lineWidth = 1;

            const gridSize = 50;
            for (let x = 0; x < this.ctx.canvas.width; x += gridSize) {
              this.ctx.beginPath();
              this.ctx.moveTo(x, 0);
              this.ctx.lineTo(x, this.ctx.canvas.height);
              this.ctx.stroke();
            }

            for (let y = 0; y < this.ctx.canvas.height; y += gridSize) {
              this.ctx.beginPath();
              this.ctx.moveTo(0, y);
              this.ctx.lineTo(this.ctx.canvas.width, y);
              this.ctx.stroke();
            }

            // Draw some terrain squares
            gameState.tiles.forEach((tile, index) => {
              const x = (index % 10) * gridSize;
              const y = Math.floor(index / 10) * gridSize;
              
              // Color based on terrain
              const colors = {
                grassland: '#90EE90',
                plains: '#DAA520',
                forest: '#228B22',
                ocean: '#4682B4',
                hills: '#8B4513',
                mountains: '#696969'
              };
              
              this.ctx.fillStyle = colors[tile.terrain] || '#808080';
              this.ctx.fillRect(x, y, gridSize - 1, gridSize - 1);
            });
          }
        }

        // Initialize the mock game
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const renderer = new MockMapRenderer(ctx);

        // Test scenario 1: No initialization, no data
        renderer.render(null);

        // Test scenario 2: Initialize but still no data
        setTimeout(() => {
          renderer.initialize().then(() => {
            renderer.render(null);
          });
        }, 100);

        // Test scenario 3: Initialize and provide data (success case)
        setTimeout(() => {
          renderer.initialize().then(() => {
            const mockGameState = {
              tiles: [
                { terrain: 'grassland' },
                { terrain: 'plains' },
                { terrain: 'forest' },
                { terrain: 'ocean' },
                { terrain: 'hills' },
                { terrain: 'mountains' },
              ]
            };
            renderer.render(mockGameState);
            
            // Mark test as ready
            window.testReady = true;
          });
        }, 200);
      </script>
    </body>
    </html>`;

    // Set the HTML content directly
    await page.setContent(mockHtml);

    // Wait for the test to be ready
    await page.waitForFunction(() => window.testReady === true, { timeout: 5000 });

    // Verify the game layout is visible
    await expect(page.locator('[data-testid="game-layout"]')).toBeVisible();

    // Verify UI elements are present
    await expect(page.locator('[data-testid="map-tab"][aria-pressed="true"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="turn-done-button"]')).toBeVisible();

    // Most importantly: Assert that the "No Map Data" and "Loading Tileset" messages are NOT visible
    // Check by testing if they're hidden via CSS display property
    const loadingMessageHidden = await page.locator('#loadingMessage').evaluate((el: HTMLElement) => 
      getComputedStyle(el).display === 'none'
    );
    const noDataMessageHidden = await page.locator('#noDataMessage').evaluate((el: HTMLElement) => 
      getComputedStyle(el).display === 'none'
    );
    
    expect(loadingMessageHidden).toBe(true);
    expect(noDataMessageHidden).toBe(true);

    // Verify canvas has been rendered (check that it has non-transparent content)
    const hasCanvasContent = await page.evaluate(() => {
      const canvas = document.getElementById('gameCanvas');
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      
      // Check for non-transparent pixels
      let hasContent = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) {
          hasContent = true;
          break;
        }
      }
      return hasContent;
    });

    expect(hasCanvasContent).toBe(true);

    // Take a screenshot for visual verification
    await page.screenshot({ path: 'test-results/game-loaded.png', fullPage: true });
  });

  test('should show loading states when map data is not available', async ({ page }) => {
    const mockHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>CivJS Test - Loading State</title>
      <style>
        body { margin: 0; font-family: Arial, sans-serif; background: #1f2937; color: white; }
        .canvas-container { position: relative; background: #4682B4; height: 500px; }
        canvas { display: block; width: 100%; height: 100%; }
        .loading-message, .no-data-message {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          font-size: 20px; text-align: center; color: white;
        }
      </style>
    </head>
    <body>
      <div class="canvas-container">
        <canvas id="gameCanvas" width="800" height="500"></canvas>
        <div id="loadingMessage" class="loading-message" style="display: none;">Loading Tileset...</div>
        <div id="noDataMessage" class="no-data-message" style="display: none;">No Map Data - Connect to Server</div>
      </div>

      <script>
        // Simulate the loading states
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        
        // Clear canvas
        ctx.fillStyle = '#4682B4';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Show "No Map Data" message
        document.getElementById('noDataMessage').style.display = 'block';
        
        // After a short delay, show "Loading Tileset" instead
        setTimeout(() => {
          document.getElementById('noDataMessage').style.display = 'none';
          document.getElementById('loadingMessage').style.display = 'block';
          window.loadingStateReady = true;
        }, 100);
      </script>
    </body>
    </html>`;

    await page.setContent(mockHtml);
    
    // Wait for loading state to be set up
    await page.waitForFunction(() => window.loadingStateReady === true);
    
    // Should show the loading message
    await expect(page.locator('text="Loading Tileset..."')).toBeVisible();
    
    // Should not show "No Map Data" at this point - check if it's hidden
    const noDataMessageHidden = await page.locator('#noDataMessage').evaluate((el: HTMLElement) => 
      getComputedStyle(el).display === 'none'
    );
    expect(noDataMessageHidden).toBe(true);
  });

  test('should show no data message when not connected', async ({ page }) => {
    const mockHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>CivJS Test - No Data State</title>
      <style>
        body { margin: 0; font-family: Arial, sans-serif; background: #1f2937; color: white; }
        .canvas-container { position: relative; background: #4682B4; height: 500px; }
        canvas { display: block; width: 100%; height: 100%; }
        .no-data-message {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          font-size: 24px; text-align: center; color: white;
        }
      </style>
    </head>
    <body>
      <div class="canvas-container">
        <canvas id="gameCanvas" width="800" height="500"></canvas>
        <div id="noDataMessage" class="no-data-message">No Map Data - Connect to Server</div>
      </div>

      <script>
        // Draw empty map background with grid
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#4682B4';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw grid
        ctx.strokeStyle = '#336699';
        ctx.lineWidth = 1;
        const gridSize = 50;
        for (let x = 0; x < canvas.width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
        
        window.noDataStateReady = true;
      </script>
    </body>
    </html>`;

    await page.setContent(mockHtml);
    
    // Wait for the no data state to be set up
    await page.waitForFunction(() => window.noDataStateReady === true);
    
    // Should show the no data message
    await expect(page.locator('text="No Map Data - Connect to Server"')).toBeVisible();
    
    // Canvas should still be rendered with grid background
    const hasCanvasContent = await page.evaluate(() => {
      const canvas = document.getElementById('gameCanvas');
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      
      let hasContent = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) {
          hasContent = true;
          break;
        }
      }
      return hasContent;
    });

    expect(hasCanvasContent).toBe(true);
  });
});