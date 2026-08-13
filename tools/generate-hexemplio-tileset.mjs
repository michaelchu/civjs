/**
 * Generate the browser Hexemplio sprite manifest directly from the pinned
 * Freeciv reference package. The original PNG sheets remain intact; the
 * manifest records each Freeciv tag's source rectangle and terrain-composition
 * metadata so the client can follow tilespec.c without a second atlas format.
 *
 * @reference reference/freeciv/data/hexemplio.tilespec
 * @reference reference/freeciv/client/tilespec.c:2480-2590,4370-4485
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format as formatWithPrettier } from 'prettier';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const referenceRoot = path.join(repositoryRoot, 'reference/freeciv');
const dataRoot = path.join(referenceRoot, 'data');
const tilespecPath = path.join(dataRoot, 'hexemplio.tilespec');
const outputRoot = path.join(repositoryRoot, 'apps/client/public/tilesets/hexemplio');
const checkOnly = process.argv.includes('--check');

const MATCH_NONE = 0;
const MATCH_SAME = 1;
const MATCH_PAIR = 2;
const MATCH_FULL = 3;
const CELL_WHOLE = 0;
const CELL_CORNER = 1;

function stripComment(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ';' && !quoted) return line.slice(0, index);
  }
  return line;
}

function quotedValues(value = '') {
  return [...value.matchAll(/"([^"]*)"/g)].map(match => match[1]);
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSections(source) {
  const sections = new Map();
  let section = '';
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (!sections.has(section)) sections.set(section, {});
      continue;
    }
    const propertyMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (section && propertyMatch) {
      sections.get(section)[propertyMatch[1]] = propertyMatch[2].trim();
    }
  }
  return sections;
}

/** Read a tilespec multiline string list without flattening section data. */
function parseStringListProperty(source, property) {
  const lines = source.split(/\r?\n/);
  const values = [];
  let collecting = false;

  for (const rawLine of lines) {
    const line = stripComment(rawLine).trim();
    if (!collecting) {
      const match = line.match(new RegExp(`^${property}\\s*=\\s*(.*)$`));
      if (!match) continue;
      collecting = true;
      values.push(...quotedValues(match[1]));
      continue;
    }

    if (!line) continue;
    if (!line.startsWith('"')) break;
    values.push(...quotedValues(line));
  }

  return values;
}

/** Preserve the ordered [extras].styles table used by fill_sprite_array(). */
function parseExtraStyles(source) {
  const section = source.match(/\[extras\]([\s\S]*?)(?=\n\s*\[|$)/)?.[1] ?? '';
  const table = section.match(/styles\s*=\s*\{([\s\S]*?)^\s*\}/m)?.[1] ?? '';
  const styles = {};
  for (const rawLine of table.split(/\r?\n/)) {
    const [name, style] = quotedValues(stripComment(rawLine));
    if (!name || !style || name === 'name' || style === 'style') continue;
    styles[name] = style;
  }
  return styles;
}

function buildTerrainProfile(tilespecSource) {
  const sections = parseSections(tilespecSource);
  const matchTypes = [0, 1, 2].map(layer =>
    quotedValues(sections.get(`layer${layer}`)?.match_types)
  );
  const terrains = {};

  for (const [sectionName, values] of sections) {
    if (!sectionName.startsWith('tile_')) continue;
    const tag = quotedValues(values.tag)[0];
    if (!tag) continue;
    const numLayers = parseInteger(values.num_layers, 1);
    const layers = [];

    for (let layer = 0; layer < numLayers; layer += 1) {
      const available = matchTypes[layer] ?? [];
      const matchType = quotedValues(values[`layer${layer}_match_type`])[0] ?? available[0] ?? '';
      const matchWith = quotedValues(values[`layer${layer}_match_with`]);
      const primaryIndex = Math.max(0, available.indexOf(matchType));
      const matchIndex = [primaryIndex];

      for (const candidate of matchWith) {
        const candidateIndex = available.indexOf(candidate);
        if (candidateIndex < 0) continue;
        if (matchWith.length > 1 && matchIndex.includes(candidateIndex)) continue;
        matchIndex.push(candidateIndex);
      }

      const matchStyle =
        matchIndex.length <= 1
          ? MATCH_NONE
          : matchIndex.length === 2
            ? matchIndex[0] === matchIndex[1]
              ? MATCH_SAME
              : MATCH_PAIR
            : MATCH_FULL;

      layers.push({
        matchStyle,
        spriteType:
          quotedValues(values[`layer${layer}_sprite_type`])[0] === 'corner'
            ? CELL_CORNER
            : CELL_WHOLE,
        matchIndices: matchIndex.length,
        matchIndex,
        dither: false,
        matchType,
        matchWith,
      });
    }

    terrains[tag] = {
      numLayers,
      blendLayer: parseInteger(values.blend_layer, 0),
      layers,
    };
  }

  return {
    mode: 'direct-cells',
    matchTypes,
    terrains,
    extraStyles: parseExtraStyles(tilespecSource),
  };
}

function parseGridSprites(specSource, specPath) {
  const sections = parseSections(specSource);
  const gfx = quotedValues(sections.get('file')?.gfx)[0];
  if (!gfx) return { gfx: null, sprites: [] };

  const sprites = [];
  let section = '';
  let inTiles = false;
  let currentPosition = null;
  const lines = specSource.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = stripComment(rawLine).trim();
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      inTiles = false;
      currentPosition = null;
      continue;
    }
    if (!section.startsWith('grid_')) continue;
    if (/^tiles\s*=\s*\{/.test(line)) {
      inTiles = true;
      continue;
    }
    if (!inTiles) continue;
    if (line.startsWith('}')) {
      inTiles = false;
      currentPosition = null;
      continue;
    }

    const rowMatch = line.match(/^(-?\d+)\s*,\s*(-?\d+)\s*,(.*)$/);
    let tagSource = line;
    if (rowMatch) {
      currentPosition = { row: Number(rowMatch[1]), column: Number(rowMatch[2]) };
      tagSource = rowMatch[3];
    }
    if (!currentPosition) continue;

    const grid = sections.get(section) ?? {};
    const dx = parseInteger(grid.dx);
    const dy = parseInteger(grid.dy);
    const border = parseInteger(grid.pixel_border);
    const borderX = parseInteger(grid.pixel_border_x, border);
    const borderY = parseInteger(grid.pixel_border_y, border);
    const xTopLeft = parseInteger(grid.x_top_left);
    const yTopLeft = parseInteger(grid.y_top_left);
    if (!dx || !dy) {
      throw new Error(`Invalid grid dimensions in ${specPath} [${section}]`);
    }

    for (const tag of quotedValues(tagSource)) {
      sprites.push({
        tag,
        image: `images/${gfx}.png`,
        x: xTopLeft + currentPosition.column * (dx + borderX),
        y: yTopLeft + currentPosition.row * (dy + borderY),
        width: dx,
        height: dy,
      });
    }
  }

  return { gfx, sprites };
}

function parseExtraSprites(specSource) {
  const sections = parseSections(specSource);
  if (!sections.has('extra')) return [];

  const extraSource = specSource.match(/\[extra\]([\s\S]*?)(?=\n\s*\[|$)/)?.[1] ?? '';
  const sprites = [];
  for (const rawLine of extraSource.split(/\r?\n/)) {
    const [tag, file] = quotedValues(stripComment(rawLine));
    if (!tag || !file || tag === 'tag' || file === 'file') continue;
    sprites.push({ tag, image: `images/${file}.png`, standalone: true });
  }
  return sprites;
}

async function getPngDimensions(filePath) {
  const png = await readFile(filePath);
  const signature = png.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || png.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`Unsupported standalone sprite: ${filePath}`);
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function scalarNumber(sections, name, fallback = 0) {
  return parseInteger(sections.get('tilespec')?.[name], fallback);
}

async function buildManifest() {
  const tilespecSource = await readFile(tilespecPath, 'utf8');
  const tilespecSections = parseSections(tilespecSource);
  const specNames = [
    ...parseStringListProperty(tilespecSource, 'files'),
    ...parseStringListProperty(tilespecSource, 'files_pixel'),
  ];
  const sprites = {};
  const preloadImages = new Set();

  for (const specName of specNames) {
    const specPath = path.join(dataRoot, specName);
    const specSource = await readFile(specPath, 'utf8');
    const parsed = parseGridSprites(specSource, specPath);
    if (parsed.gfx) preloadImages.add(`images/${parsed.gfx}.png`);
    for (const sprite of parsed.sprites) {
      const { tag, ...rectangle } = sprite;
      sprites[tag] = rectangle;
    }
    for (const sprite of parseExtraSprites(specSource)) {
      const { tag, ...source } = sprite;
      const dimensions = await getPngDimensions(path.join(dataRoot, source.image.slice(7)));
      sprites[tag] = { ...source, x: 0, y: 0, ...dimensions };
    }
  }

  const sourceRevision = execFileSync('git', ['-C', referenceRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const tilespec = tilespecSections.get('tilespec') ?? {};

  return {
    schemaVersion: 2,
    id: 'hexemplio',
    name: quotedValues(tilespec.name)[0] ?? 'Hexemplio',
    sourceRevision,
    sourceTilespec: 'data/hexemplio.tilespec',
    sourceSpecs: specNames.map(name => `data/${name}`),
    license: 'GPL-2.0-or-later',
    topologyId: 3,
    geometry: {
      tileWidth: scalarNumber(tilespecSections, 'normal_tile_width', 126),
      tileHeight: scalarNumber(tilespecSections, 'normal_tile_height', 64),
      fullTileWidth: scalarNumber(tilespecSections, 'normal_tile_width', 126),
      fullTileHeight: (scalarNumber(tilespecSections, 'normal_tile_height', 64) * 3) / 2,
      hexWidth: scalarNumber(tilespecSections, 'hex_side', 16),
      hexHeight: 0,
    },
    offsets: {
      unitFlagX: scalarNumber(tilespecSections, 'unit_flag_offset_x'),
      unitFlagY: scalarNumber(tilespecSections, 'unit_flag_offset_y'),
      cityFlagX: scalarNumber(tilespecSections, 'city_flag_offset_x'),
      cityFlagY: scalarNumber(tilespecSections, 'city_flag_offset_y'),
      unitX: scalarNumber(tilespecSections, 'unit_offset_x'),
      unitY: scalarNumber(tilespecSections, 'unit_offset_y'),
      activityX: scalarNumber(tilespecSections, 'activity_offset_x'),
      activityY: scalarNumber(tilespecSections, 'activity_offset_y'),
      selectX: scalarNumber(tilespecSections, 'select_offset_x'),
      selectY: scalarNumber(tilespecSections, 'select_offset_y'),
      stackX: scalarNumber(tilespecSections, 'stack_size_offset_x'),
      stackY: scalarNumber(tilespecSections, 'stack_size_offset_y'),
      cityX: scalarNumber(tilespecSections, 'city_offset_x'),
      cityY: scalarNumber(tilespecSections, 'city_offset_y'),
      citybarX: scalarNumber(
        tilespecSections,
        'citybar_offset_x',
        scalarNumber(tilespecSections, 'normal_tile_width', 126) / 2
      ),
      citybarY: scalarNumber(tilespecSections, 'citybar_offset_y'),
      tileLabelX: scalarNumber(tilespecSections, 'tilelabel_offset_x'),
      tileLabelY: scalarNumber(tilespecSections, 'tilelabel_offset_y'),
    },
    terrainComposition: buildTerrainProfile(tilespecSource),
    renderProfile: {
      fogStyle: 'auto',
      darknessStyle: 'cardinal-single',
      layerOrder: parseStringListProperty(tilespecSource, 'layer_order'),
    },
    preloadImages: [...preloadImages].sort(),
    sprites: Object.fromEntries(
      Object.entries(sprites).sort(([left], [right]) => left.localeCompare(right))
    ),
  };
}

function manifestImages(manifest) {
  return [...new Set(Object.values(manifest.sprites).map(sprite => sprite.image))].sort();
}

async function assertGeneratedFile(filePath, expected) {
  let actual;
  try {
    actual = await readFile(filePath);
  } catch {
    throw new Error(
      `Missing generated Hexemplio asset: ${path.relative(repositoryRoot, filePath)}`
    );
  }
  if (!actual.equals(expected)) {
    throw new Error(`Stale generated Hexemplio asset: ${path.relative(repositoryRoot, filePath)}`);
  }
}

async function main() {
  await stat(tilespecPath);
  const manifest = await buildManifest();
  const manifestContents = await formatWithPrettier(JSON.stringify(manifest), {
    parser: 'json',
  });
  const licenseSource = path.join(referenceRoot, 'COPYING');

  if (checkOnly) {
    await assertGeneratedFile(
      path.join(outputRoot, 'manifest.json'),
      Buffer.from(manifestContents)
    );
    await assertGeneratedFile(path.join(outputRoot, 'COPYING'), await readFile(licenseSource));
    for (const image of manifestImages(manifest)) {
      const relativeImage = image.slice('images/'.length);
      await assertGeneratedFile(
        path.join(outputRoot, image),
        await readFile(path.join(dataRoot, relativeImage))
      );
    }
    console.log(
      `Hexemplio assets match Freeciv ${manifest.sourceRevision} (${Object.keys(manifest.sprites).length} tags).`
    );
    return;
  }

  await mkdir(path.join(outputRoot, 'images'), { recursive: true });
  await writeFile(path.join(outputRoot, 'manifest.json'), manifestContents);
  await copyFile(licenseSource, path.join(outputRoot, 'COPYING'));
  for (const image of manifestImages(manifest)) {
    const relativeImage = image.slice('images/'.length);
    const source = path.join(dataRoot, relativeImage);
    const destination = path.join(outputRoot, image);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  console.log(
    `Generated Hexemplio assets from Freeciv ${manifest.sourceRevision} (${Object.keys(manifest.sprites).length} tags).`
  );
}

await main();
