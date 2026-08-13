/**
 * Package the exact Amplio2 browser assets used by the pinned freeciv-web
 * reference. The browser client owns both the generated atlas layout and its
 * Javascript terrain-composition profile; this tool converts those artifacts
 * into a provider-owned manifest without evaluating globals in the app.
 *
 * Normal generation consumes an extractor output directory supplied with
 * `--generated-dir`. `--check` is dependency-free and validates the committed
 * package, both source revisions, source hashes, geometry, and every sprite
 * rectangle. To reproduce the extractor output, check out `sourceFreecivRevision`,
 * apply `sourcePatch`, and run `sourceExtractor` as documented in the package.
 *
 * @reference reference/freeciv-web/freeciv/version.txt
 * @reference reference/freeciv-web/scripts/freeciv-img-extract/img-extract.py
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tileset_config_amplio2.js
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { format as formatWithPrettier } from 'prettier';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const referenceWebRoot = path.join(repositoryRoot, 'reference/freeciv-web');
const referenceFreecivRoot = path.join(repositoryRoot, 'reference/freeciv');
const configPath = path.join(
  referenceWebRoot,
  'freeciv-web/src/main/webapp/javascript/2dcanvas/tileset_config_amplio2.js'
);
const versionPath = path.join(referenceWebRoot, 'freeciv/version.txt');
const extractorPath = path.join(referenceWebRoot, 'scripts/freeciv-img-extract/img-extract.py');
const patchPath = path.join(referenceWebRoot, 'freeciv/patches/RevertAmplio2ExtraUnits.patch');
const outputRoot = path.join(repositoryRoot, 'apps/client/public/tilesets/amplio2');
const checkOnly = process.argv.includes('--check');
const generatedDirectoryArgument = process.argv.find(argument =>
  argument.startsWith('--generated-dir=')
);
const generatedRoot = generatedDirectoryArgument
  ? path.resolve(generatedDirectoryArgument.slice('--generated-dir='.length))
  : null;
const manifestPath = path.join(outputRoot, 'manifest.json');

const sourceRelative = absolutePath => path.relative(referenceWebRoot, absolutePath);
const sha256 = contents => createHash('sha256').update(contents).digest('hex');

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

function getPngDimensions(contents, filePath) {
  if (
    contents.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    contents.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new Error(`Unsupported Amplio2 image: ${filePath}`);
  }
  return { width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) };
}

function parseFreecivRevision(versionSource) {
  const revision = versionSource.match(/^FCREV=([0-9a-f]{40})$/m)?.[1];
  if (!revision) throw new Error(`Unable to parse FCREV from ${versionPath}`);
  return revision;
}

function evaluateReferenceConfig(source) {
  const context = {
    MATCH_NONE: 0,
    MATCH_SAME: 1,
    MATCH_PAIR: 2,
    MATCH_FULL: 3,
    CELL_WHOLE: 0,
    CELL_CORNER: 1,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: configPath });
  return context;
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildTerrainComposition(config) {
  const terrains = {};
  for (const [graphic, tile] of Object.entries(config.ts_tiles)) {
    const numLayers = Number(tile.num_layers ?? 0);
    terrains[graphic] = {
      numLayers,
      blendLayer: Number(tile.is_blended ? 1 : 0),
      layers: Array.from({ length: numLayers }, (_, layer) => {
        const composition = config.tile_types_setup[`l${layer}.${graphic}`];
        if (!composition) return null;
        const matchWith = tile[`layer${layer}_match_with`];
        return {
          matchStyle: Number(composition.match_style),
          spriteType: Number(composition.sprite_type),
          matchIndices: Number(composition.match_indices),
          matchIndex: toPlainJson(composition.match_index),
          dither: Boolean(composition.dither),
          matchType: String(tile[`layer${layer}_match_type`] ?? ''),
          matchWith: Array.isArray(matchWith) ? toPlainJson(matchWith).map(String) : [],
        };
      }),
    };
  }

  return {
    mode: 'legacy-cellgroup',
    matchTypes: toPlainJson(config.ts_layer).map(layer =>
      Array.isArray(layer?.match_types) ? layer.match_types : []
    ),
    terrains,
    cellgroupMap: toPlainJson(config.cellgroup_map),
  };
}

function parseGeneratedSpec(specSource) {
  const payload = specSource
    .replace(/^\s*var\s+tileset\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .trim();
  const generated = JSON.parse(payload);
  return Object.fromEntries(
    Object.entries(generated)
      .map(([tag, rectangle]) => {
        if (!Array.isArray(rectangle) || rectangle.length !== 5) {
          throw new Error(`Invalid generated Amplio2 rectangle for ${tag}`);
        }
        const [x, y, width, height, sheet] = rectangle.map(Number);
        return [
          tag,
          {
            image: `images/freeciv-web-tileset-amplio2-${sheet}.png`,
            x,
            y,
            width,
            height,
          },
        ];
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

async function readSourceMetadata(requireFreecivObject = false) {
  const [configSource, versionSource, extractorContents, patchContents] = await Promise.all([
    readFile(configPath, 'utf8'),
    readFile(versionPath, 'utf8'),
    readFile(extractorPath),
    readFile(patchPath),
  ]);
  const sourceWebRevision = execFileSync('git', ['-C', referenceWebRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const sourceFreecivRevision = parseFreecivRevision(versionSource);
  if (requireFreecivObject) {
    try {
      execFileSync('git', [
        '-C',
        referenceFreecivRoot,
        'cat-file',
        '-e',
        `${sourceFreecivRevision}^{commit}`,
      ]);
    } catch {
      throw new Error(
        `The pinned Freeciv object ${sourceFreecivRevision} required by freeciv-web is unavailable. ` +
          'Fetch that historical object in reference/freeciv before regenerating.'
      );
    }
  }
  return {
    configSource,
    sourceWebRevision,
    sourceFreecivRevision,
    sourceHashes: {
      config: sha256(configSource),
      extractor: sha256(extractorContents),
      patch: sha256(patchContents),
    },
  };
}

async function buildManifestFromGenerated(generatedDirectory) {
  const metadata = await readSourceMetadata(true);
  const config = evaluateReferenceConfig(metadata.configSource);
  const generatedSpecPath = path.join(generatedDirectory, 'tileset_spec_amplio2.js');
  const specContents = await readFile(generatedSpecPath);
  const sprites = parseGeneratedSpec(specContents.toString('utf8'));
  const atlas = [];
  for (let index = 0; index < Number(config.tileset_image_count); index += 1) {
    const name = `freeciv-web-tileset-amplio2-${index}.png`;
    const contents = await readFile(path.join(generatedDirectory, name));
    atlas.push({
      image: `images/${name}`,
      ...getPngDimensions(contents, name),
      sha256: sha256(contents),
    });
  }

  return {
    schemaVersion: 1,
    id: 'amplio2',
    name: 'Amplio2',
    sourceWebRevision: metadata.sourceWebRevision,
    sourceFreecivRevision: metadata.sourceFreecivRevision,
    sourceConfig: sourceRelative(configPath),
    sourceExtractor: sourceRelative(extractorPath),
    sourcePatch: sourceRelative(patchPath),
    sourceHashes: metadata.sourceHashes,
    generatedSpec: {
      file: 'tileset_spec_amplio2.js',
      sha256: sha256(specContents),
    },
    license: 'GPL-2.0-or-later',
    topologyId: 1,
    geometry: {
      tileWidth: Number(config.tileset_tile_width),
      tileHeight: Number(config.tileset_tile_height),
      fullTileWidth: Number(config.normal_tile_width),
      fullTileHeight: Number(config.normal_tile_height),
      hexWidth: 0,
      hexHeight: 0,
    },
    offsets: {
      unitFlagX: Number(config.unit_flag_offset_x),
      unitFlagY: -Number(config.unit_flag_offset_y),
      cityFlagX: Number(config.city_flag_offset_x),
      cityFlagY: -Number(config.city_flag_offset_y),
      unitX: Number(config.unit_offset_x),
      unitY: -Number(config.unit_offset_y),
      activityX: Number(config.unit_activity_offset_x),
      activityY: -Number(config.unit_activity_offset_y),
      selectX: 0,
      selectY: 0,
      stackX: Number(config.unit_flag_offset_x) - 25,
      stackY: -Number(config.unit_flag_offset_y) - 15,
      cityX: 0,
      cityY: -Number(config.unit_offset_y),
      citybarX: Number(config.citybar_offset_x),
      citybarY: Number(config.citybar_offset_y),
      tileLabelX: Number(config.tilelabel_offset_x),
      tileLabelY: Number(config.tilelabel_offset_y),
    },
    renderProfile: {
      fogStyle: 'auto',
      darknessStyle: 'none',
      layerOrder: [
        'Terrain1',
        'Terrain2',
        'Terrain3',
        'Roads',
        'Special1',
        'City1',
        'Special2',
        'Unit',
        'Fog',
        'Special3',
        'TileLabel',
        'CityBar',
        'Goto',
      ],
    },
    terrainComposition: buildTerrainComposition(config),
    preloadImages: atlas.map(entry => entry.image),
    atlas,
    sprites,
  };
}

async function assertHash(filePath, expectedHash, label) {
  const contents = await readFile(filePath);
  const actualHash = sha256(contents);
  if (actualHash !== expectedHash) {
    throw new Error(`${label} hash mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
  return contents;
}

async function checkManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const metadata = await readSourceMetadata();
  if (manifest.schemaVersion !== 1 || manifest.topologyId !== 1) {
    throw new Error('Unsupported Amplio2 manifest');
  }
  if (manifest.sourceWebRevision !== metadata.sourceWebRevision) {
    throw new Error(
      `Amplio2 package targets freeciv-web ${manifest.sourceWebRevision}, ` +
        `but the submodule is ${metadata.sourceWebRevision}`
    );
  }
  if (manifest.sourceFreecivRevision !== metadata.sourceFreecivRevision) {
    throw new Error(
      `Amplio2 package targets Freeciv ${manifest.sourceFreecivRevision}, ` +
        `but freeciv-web pins ${metadata.sourceFreecivRevision}`
    );
  }
  for (const [name, expected] of Object.entries(metadata.sourceHashes)) {
    if (manifest.sourceHashes[name] !== expected) {
      throw new Error(`Amplio2 ${name} source hash is stale`);
    }
  }

  const specContents = await assertHash(
    path.join(outputRoot, manifest.generatedSpec.file),
    manifest.generatedSpec.sha256,
    'Amplio2 generated spec'
  );
  const specSprites = parseGeneratedSpec(specContents.toString('utf8'));
  if (JSON.stringify(specSprites) !== JSON.stringify(manifest.sprites)) {
    throw new Error('Amplio2 manifest sprite rectangles differ from the generated browser spec');
  }

  const atlasByImage = new Map(manifest.atlas.map(entry => [entry.image, entry]));
  for (const entry of manifest.atlas) {
    const imagePath = path.join(outputRoot, entry.image);
    const contents = await assertHash(imagePath, entry.sha256, `Amplio2 ${entry.image}`);
    const dimensions = getPngDimensions(contents, imagePath);
    if (dimensions.width !== entry.width || dimensions.height !== entry.height) {
      throw new Error(`Amplio2 ${entry.image} dimensions differ from the manifest`);
    }
  }
  for (const [tag, sprite] of Object.entries(manifest.sprites)) {
    const atlasEntry = atlasByImage.get(sprite.image);
    if (!atlasEntry) throw new Error(`Amplio2 sprite ${tag} uses an unknown image`);
    if (
      sprite.x < 0 ||
      sprite.y < 0 ||
      sprite.width <= 0 ||
      sprite.height <= 0 ||
      sprite.x + sprite.width > atlasEntry.width ||
      sprite.y + sprite.height > atlasEntry.height
    ) {
      throw new Error(`Amplio2 sprite ${tag} falls outside ${sprite.image}`);
    }
  }
  if (Object.keys(manifest.sprites).length !== 2770) {
    throw new Error(`Unexpected Amplio2 sprite count: ${Object.keys(manifest.sprites).length}`);
  }

  console.log(
    `Amplio2 package matches freeciv-web ${manifest.sourceWebRevision} / ` +
      `Freeciv ${manifest.sourceFreecivRevision} (${Object.keys(manifest.sprites).length} tags).`
  );
}

async function generatePackage(generatedDirectory) {
  await stat(generatedDirectory);
  const manifest = await buildManifestFromGenerated(generatedDirectory);
  const manifestContents = await formatWithPrettier(JSON.stringify(manifest), { parser: 'json' });
  await mkdir(path.join(outputRoot, 'images'), { recursive: true });
  await writeFile(manifestPath, manifestContents);
  await copyFile(
    path.join(generatedDirectory, manifest.generatedSpec.file),
    path.join(outputRoot, manifest.generatedSpec.file)
  );
  for (const entry of manifest.atlas) {
    await copyFile(
      path.join(generatedDirectory, path.basename(entry.image)),
      path.join(outputRoot, entry.image)
    );
  }
  await copyFile(path.join(referenceFreecivRoot, 'COPYING'), path.join(outputRoot, 'COPYING'));
  console.log(
    `Generated Amplio2 package from freeciv-web ${manifest.sourceWebRevision} / ` +
      `Freeciv ${manifest.sourceFreecivRevision} (${Object.keys(manifest.sprites).length} tags).`
  );
}

if (checkOnly) {
  await checkManifest();
} else if (generatedRoot) {
  await generatePackage(generatedRoot);
} else {
  throw new Error(
    'Pass --generated-dir=/absolute/path containing the freeciv-web extractor output. ' +
      'See apps/client/public/tilesets/amplio2/README.md.'
  );
}
