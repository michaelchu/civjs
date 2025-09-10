// Test color assignment logic directly
const { getNextPlayerColorTheme, NATION_COLOR_THEMES } = require('./apps/server/dist/utils/playerColors');

console.log('=== Color Assignment Test ===\n');

// Test sequential player joins
console.log('Testing sequential player joins:\n');

let usedThemes = [];

for (let i = 0; i < 5; i++) {
  const newTheme = getNextPlayerColorTheme(usedThemes);
  console.log(`Player ${i+1}: ${newTheme.name} - RGB(${newTheme.primary.r}, ${newTheme.primary.g}, ${newTheme.primary.b})`);
  
  // Add the new theme to used themes (simulating what happens in the server)
  usedThemes.push({
    primary: newTheme.primary,
    secondary: { r: 255, g: 255, b: 255 },
    tertiary: { r: 0, g: 0, b: 0 },
    name: 'Legacy',
  });
}

console.log('\n=== Testing with real vs legacy theme comparison ===\n');

// Reset and test with a mix of real themes and legacy format
usedThemes = [
  // Player 1: Real theme format (what should happen)
  NATION_COLOR_THEMES[0], // Roman Red
  // Player 2: Legacy format (what's happening in server)
  {
    primary: NATION_COLOR_THEMES[1].primary, // Imperial Purple primary
    secondary: { r: 255, g: 255, b: 255 },
    tertiary: { r: 0, g: 0, b: 0 },
    name: 'Legacy',
  }
];

console.log('Used themes:');
usedThemes.forEach((theme, i) => {
  console.log(`  ${i+1}. ${theme.name} - Primary: RGB(${theme.primary.r}, ${theme.primary.g}, ${theme.primary.b})`);
});

const nextTheme = getNextPlayerColorTheme(usedThemes);
console.log(`\nNext assigned: ${nextTheme.name} - RGB(${nextTheme.primary.r}, ${nextTheme.primary.g}, ${nextTheme.primary.b})`);

// Check if it's correctly avoiding the used primaries
const conflictsWithUsed = usedThemes.some(used => 
  used.primary.r === nextTheme.primary.r &&
  used.primary.g === nextTheme.primary.g &&
  used.primary.b === nextTheme.primary.b
);

console.log(`Conflicts with used colors: ${conflictsWithUsed}`);