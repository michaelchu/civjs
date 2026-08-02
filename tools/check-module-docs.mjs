/**
 * Verifies that each production source module starts with an explicit module
 * JSDoc block. Tests and ambient Vite declarations are intentionally outside
 * this convention.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const sourceRoots = ['apps/client/src', 'apps/server/src'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

function isExcluded(filePath) {
  const normalized = filePath.split(sep).join('/');

  return (
    /\/(?:__tests__|tests|test)\//.test(normalized) ||
    /\.(?:test|spec)\.[^.]+$/.test(normalized) ||
    normalized.endsWith('/vite-env.d.ts')
  );
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const filePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectSourceFiles(filePath);
      }

      return sourceExtensions.has(extname(entry.name)) && !isExcluded(filePath) ? [filePath] : [];
    })
  );

  return files.flat();
}

function hasModuleDoc(source) {
  const doc = source.match(/^\uFEFF?\/\*\*[\s\S]*?\*\//)?.[0];
  return doc !== undefined && /\*\s+@module\s+\S+/.test(doc);
}

const sourceFiles = (await Promise.all(sourceRoots.map(collectSourceFiles))).flat().sort();
const undocumented = (
  await Promise.all(
    sourceFiles.map(async filePath => ({
      filePath,
      documented: hasModuleDoc(await readFile(filePath, 'utf8')),
    }))
  )
)
  .filter(({ documented }) => !documented)
  .map(({ filePath }) => relative(process.cwd(), filePath));

if (undocumented.length > 0) {
  console.error('Missing module JSDoc blocks:');
  undocumented.forEach(filePath => console.error(`- ${filePath}`));
  process.exitCode = 1;
} else {
  console.log(`Verified module docs in ${sourceFiles.length} production source files.`);
}
