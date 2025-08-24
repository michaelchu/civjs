# Frontend Tests

This directory contains browser-based tests for the CivJS game frontend using Playwright.

## Test Files

### `game-creation-flow-simple.spec.ts`
Tests the game creation flow and map rendering functionality:

- **Main Test**: Verifies that when the game loads successfully, the map displays properly without showing "No Map Data - Connect to Server" or "Loading Tileset..." placeholder messages.
- **Loading State Test**: Verifies that loading states are shown appropriately when map data is not yet available.
- **No Data State Test**: Verifies that the "No Map Data" message is shown when not connected to the server.

### Key Assertions

The tests specifically verify that:
1. When game data is loaded, placeholder messages should be hidden (`display: none`)
2. Canvas should render actual content (non-transparent pixels)
3. Game UI elements (tabs, status panel, turn button) should be visible and properly labeled
4. Different loading states are handled correctly

## Running Tests

```bash
# Run all tests
npm test

# Run tests with UI (interactive mode)
npm run test:ui

# Run tests in headed mode (see browser)
npm run test:headed

# From root directory
npm run test:client
```

## Test Architecture

These tests use static HTML pages with mock JavaScript to simulate the game environment. This approach was chosen to:

1. Avoid dependency issues with the dev server build process
2. Focus specifically on the map rendering logic and UI states
3. Provide fast, reliable test execution
4. Test the exact conditions mentioned in the requirements

The tests mock:
- Canvas 2D rendering context
- MapRenderer behavior 
- Game state data (tiles, map dimensions)
- UI component interactions

## Screenshots

Test runs generate screenshots in the `test-results/` directory for visual verification of the rendered state.

## Future Enhancements

For a full integration test suite, you would want to:
1. Fix the Tailwind CSS build configuration 
2. Add proper server mocking with realistic Socket.IO responses
3. Test actual React component rendering
4. Add performance and accessibility testing