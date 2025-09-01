#!/usr/bin/env node

/**
 * Flag Download Tool for CivJS Nation System
 * 
 * This script downloads flag graphics from the Freeciv repository for all 573+ nations.
 * Flags are essential for the Nations tab UI to provide visual identification of civilizations.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

// Freeciv flag repository base URL
const FREECIV_FLAGS_BASE_URL = 'https://raw.githubusercontent.com/freeciv/freeciv/main/data/flags/';
const OUTPUT_DIR = path.join(__dirname, '..', 'apps', 'client', 'public', 'flags');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Downloads a flag from Freeciv repository
 */
async function downloadFlag(nationId) {
  const flagUrl = `${FREECIV_FLAGS_BASE_URL}${nationId}.png`;
  const outputPath = path.join(OUTPUT_DIR, `${nationId}.png`);

  return new Promise((resolve, reject) => {
    // Skip if file already exists
    if (fs.existsSync(outputPath)) {
      console.log(`✓ Flag already exists: ${nationId}.png`);
      resolve(true);
      return;
    }

    const file = fs.createWriteStream(outputPath);
    
    https.get(flagUrl, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`✓ Downloaded flag: ${nationId}.png`);
          resolve(true);
        });
      } else {
        fs.unlink(outputPath, () => {}); // Clean up partial file
        console.log(`✗ Flag not found: ${nationId}.png (${response.statusCode})`);
        resolve(false);
      }
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {}); // Clean up partial file
      console.log(`✗ Error downloading ${nationId}.png: ${err.message}`);
      resolve(false);
    });
  });
}

/**
 * Creates a default unknown flag placeholder
 */
function createUnknownFlag() {
  const unknownPath = path.join(OUTPUT_DIR, 'unknown.png');
  
  if (!fs.existsSync(unknownPath)) {
    // Create a simple 48x32 placeholder image (in reality, you'd use a proper image library)
    const placeholder = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32">
  <rect width="48" height="32" fill="#cccccc" stroke="#999999"/>
  <text x="24" y="20" text-anchor="middle" font-family="monospace" font-size="8" fill="#666666">?</text>
</svg>`;
    
    fs.writeFileSync(unknownPath.replace('.png', '.svg'), placeholder);
    console.log('✓ Created unknown flag placeholder');
  }
}

/**
 * Main function to download all flags
 */
async function downloadAllFlags() {
  console.log('CivJS Flag Download Tool');
  console.log('========================');
  console.log(`Downloading flags to: ${OUTPUT_DIR}`);
  console.log('');

  // Load nation data
  const nationsPath = path.join(__dirname, '..', 'apps', 'shared', 'src', 'data', 'nations.json');
  
  if (!fs.existsSync(nationsPath)) {
    console.error('❌ Nations data file not found. Please run convert-nations.js first.');
    process.exit(1);
  }

  const nations = JSON.parse(fs.readFileSync(nationsPath, 'utf-8'));
  
  console.log(`Found ${nations.length} nations to process`);
  console.log('');

  // Create unknown flag placeholder
  createUnknownFlag();

  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // Download flags in batches to avoid overwhelming the server
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < nations.length; i += BATCH_SIZE) {
    const batch = nations.slice(i, i + BATCH_SIZE);
    
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(nations.length / BATCH_SIZE)}`);
    
    const promises = batch.map(nation => downloadFlag(nation.id));
    const results = await Promise.all(promises);
    
    results.forEach((success, index) => {
      if (success === true) {
        if (fs.existsSync(path.join(OUTPUT_DIR, `${batch[index].id}.png`))) {
          downloadedCount++;
        } else {
          skippedCount++;
        }
      } else {
        failedCount++;
      }
    });

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('');
  console.log('Download Summary:');
  console.log(`✓ Downloaded: ${downloadedCount} flags`);
  console.log(`⊘ Already existed: ${skippedCount} flags`);
  console.log(`✗ Failed: ${failedCount} flags`);
  console.log('');
  console.log('Flag download complete!');
  console.log('');
  console.log('Note: Some nations may not have official flags in the Freeciv repository.');
  console.log('Missing flags will display as placeholder graphics in the UI.');
}

// Run the download process
if (require.main === module) {
  downloadAllFlags().catch(console.error);
}

module.exports = { downloadFlag, downloadAllFlags };