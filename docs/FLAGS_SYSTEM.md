# CivJS Flag Graphics System

This document describes the flag graphics system implemented for the CivJS Nations tab, providing visual identification for all 573+ Freeciv nations.

## Overview

The flag graphics system consists of several components:

1. **FlagGraphics Component** - React component for rendering nation flags
2. **Flag Download Tool** - Script to download flag graphics from Freeciv repository
3. **Fallback System** - Graceful degradation for missing flag graphics
4. **Flag Assets** - Directory structure for storing flag images

## Components

### FlagGraphics Component

Located: `apps/client/src/components/GameUI/NationsTab/FlagGraphics.tsx`

A React component that renders nation flags with multiple fallback mechanisms:

```tsx
<FlagGraphics nationId="american" size="medium" />
```

**Props:**
- `nationId: string` - The nation identifier (e.g., 'american', 'roman')
- `size?: 'small' | 'medium' | 'large'` - Flag size (default: 'medium')
- `className?: string` - Additional CSS classes

**Fallback Sequence:**
1. Try loading `/flags/{nationId}.png`
2. If fails, try loading `/flags/unknown.svg`
3. If fails, render text placeholder with nation abbreviation

**Sizes:**
- Small: 24x16 pixels
- Medium: 36x24 pixels  
- Large: 48x32 pixels

### Flag Download Tool

Located: `tools/download-flags.js`

Node.js script that downloads flag graphics from the official Freeciv repository.

**Usage:**
```bash
cd /root/repo
node tools/download-flags.js
```

**Features:**
- Downloads flags for all 573+ nations from Freeciv GitHub repository
- Batch processing to avoid overwhelming the server
- Skip existing files to allow incremental updates
- Progress reporting and error handling
- Creates unknown.svg placeholder for missing flags

**Source:** https://raw.githubusercontent.com/freeciv/freeciv/main/data/flags/

## Directory Structure

```
apps/client/public/flags/
├── american.png          # Individual nation flags
├── roman.png
├── chinese.png
├── ...
├── unknown.svg           # Fallback placeholder
└── [573+ nation flags]
```

## Integration with Nations Tab

The flag graphics system integrates seamlessly with the Nations tab components:

- **NationsTable** - Displays flags in the player list
- **PlayerRow** - Shows individual player flags
- **DiplomaticActions** - Visual identification in diplomatic interactions
- **IntelligenceDialog** - Flag display in intelligence reports

## Implementation Status

### ✅ Completed
- FlagGraphics React component with fallback system
- Flag download tool with batch processing
- SVG placeholder for unknown flags
- Integration points defined
- Documentation

### 🔄 Next Steps
1. Run flag download tool to populate flag graphics:
   ```bash
   node tools/download-flags.js
   ```

2. Update existing UI components to use FlagGraphics:
   ```tsx
   import { FlagGraphics } from './FlagGraphics';
   
   // In PlayerRow component
   <FlagGraphics nationId={player.nationId} size="small" />
   ```

3. Add flag display to Nations selection dialog

4. Implement flag caching and optimization for production

## Technical Notes

### Flag Sources
- Primary source: Freeciv official repository
- Format: PNG images, typically 48x32 pixels
- License: Compatible with GPL (same as Freeciv)
- Total count: 573+ unique nation flags

### Performance Considerations
- Lazy loading: Flags load only when visible
- Error boundaries: Failed loads don't break UI
- Fallback system: Always provides visual feedback
- Caching: Browser caches downloaded flags

### Accessibility
- Alt text: Descriptive alt text for screen readers
- Title attributes: Hover tooltips with nation names
- High contrast: Flags provide visual distinction
- Text fallback: Readable abbreviations when graphics fail

## Maintenance

### Adding New Nations
1. Add nation data to `apps/shared/src/data/nations.json`
2. Run flag download tool to fetch flag graphic
3. Flag system automatically supports new nations

### Updating Flags
1. Delete specific flag files to force re-download
2. Run flag download tool
3. New versions will be downloaded automatically

### Troubleshooting
- Check browser console for 404 errors on missing flags
- Verify flag files exist in `public/flags/` directory
- Test fallback system by temporarily renaming flag files
- Use browser dev tools to inspect flag loading

## Integration Examples

### Basic Flag Display
```tsx
<FlagGraphics nationId="american" size="medium" />
```

### In Table Rows
```tsx
<TableRow>
  <TableCell>
    <div className="flex items-center gap-2">
      <FlagGraphics nationId={player.nationId} size="small" />
      <span>{player.name}</span>
    </div>
  </TableCell>
</TableRow>
```

### In Diplomatic Dialogs
```tsx
<DialogHeader>
  <div className="flex items-center gap-3">
    <FlagGraphics nationId={targetPlayer.nationId} size="large" />
    <div>
      <h2>Diplomatic Relations</h2>
      <p>with {targetPlayer.nationName}</p>
    </div>
  </div>
</DialogHeader>
```

This flag graphics system provides a robust, scalable solution for visual nation identification throughout the CivJS Nations tab interface.