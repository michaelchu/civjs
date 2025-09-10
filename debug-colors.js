// Debug script to test color selection logic
const { getNextPlayerColorTheme, NATION_COLOR_THEMES } = require('./apps/server/dist/utils/playerColors');

// Simulate what happens in the current code
function simulateCurrentLogic() {
  console.log('=== Current Color Selection Logic Debug ===\n');
  
  // Simulate 3 players joining
  const players = [
    { color: { r: 204, g: 0, b: 0 } }, // Roman Red primary
    { color: { r: 138, g: 43, b: 226 } }, // Imperial Purple primary  
    { color: { r: 34, g: 139, b: 34 } }, // Forest Green primary
  ];
  
  console.log('Existing players:', players.map(p => p.color));
  
  // Current logic converts ALL players to this same "Legacy" format:
  const usedThemes = players.map(p => ({
    primary: p.color,
    secondary: { r: 255, g: 255, b: 255 }, // Always white
    tertiary: { r: 0, g: 0, b: 0 }, // Always black
    name: 'Legacy',
  }));
  
  console.log('\nUsed themes (current logic):');
  usedThemes.forEach((theme, i) => {
    console.log(`Player ${i+1}: ${theme.name} - Primary: rgb(${theme.primary.r}, ${theme.primary.g}, ${theme.primary.b})`);
  });
  
  // Now get next color
  const nextTheme = getNextPlayerColorTheme(usedThemes);
  console.log(`\nNext assigned color: ${nextTheme.name} - Primary: rgb(${nextTheme.primary.r}, ${nextTheme.primary.g}, ${nextTheme.primary.b})`);
  
  // Check if it matches any of the "used" primaries
  const matchesUsed = usedThemes.some(used => 
    used.primary.r === nextTheme.primary.r &&
    used.primary.g === nextTheme.primary.g &&
    used.primary.b === nextTheme.primary.b
  );
  
  console.log(`Does next color match any used primary? ${matchesUsed}`);
  console.log('\nAvailable themes:');
  NATION_COLOR_THEMES.forEach((theme, i) => {
    const isUsed = usedThemes.some(used => 
      used.primary.r === theme.primary.r &&
      used.primary.g === theme.primary.g &&
      used.primary.b === theme.primary.b
    );
    console.log(`${i+1}. ${theme.name}: ${isUsed ? 'USED' : 'available'}`);
  });
}

simulateCurrentLogic();