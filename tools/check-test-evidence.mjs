/**
 * Validates explicit parity and CivJS-stack evidence declarations placed
 * immediately before individual test cases. The checker validates metadata,
 * not whether the asserted behavior itself is a correct port.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const testRoots = ['apps/client/src', 'apps/server/src', 'apps/server/tests', 'tests'];
const testFilePattern = /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/;
const evidenceBlockPattern = /\/\*\*[\s\S]*?\*\//g;
const referencePattern =
  /@reference\s+(reference\/(?:freeciv|freeciv-web)\/[^:\s]+):(\d+)(?:-(\d+))?/g;
const referenceLineCounts = new Map();

async function collectTestFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = await Promise.all(
    entries.map(async entry => {
      const filePath = join(directory, entry.name);
      if (entry.isDirectory()) return collectTestFiles(filePath);
      return testFilePattern.test(entry.name) ? [filePath] : [];
    })
  );

  return files.flat();
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function followsTestDeclaration(source) {
  return /^\s*(?:it|test)(?:\.(?:only|skip))?(?:\.each(?:<[\s\S]*?>)?\s*\(|\s*\()/.test(source);
}

async function lineCount(filePath) {
  if (!referenceLineCounts.has(filePath)) {
    const source = await readFile(filePath, 'utf8');
    referenceLineCounts.set(filePath, source.split('\n').length);
  }

  return referenceLineCounts.get(filePath);
}

const testFiles = (await Promise.all(testRoots.map(collectTestFiles))).flat().sort();
const errors = [];
let parityDeclarations = 0;
let stackDeclarations = 0;

for (const filePath of testFiles) {
  const source = await readFile(filePath, 'utf8');

  for (const match of source.matchAll(evidenceBlockPattern)) {
    const block = match[0];
    const evidence = block.match(/@evidence\s+(\S+)/);
    if (!evidence) continue;

    const location = `${relative(process.cwd(), filePath)}:${lineAt(source, match.index)}`;
    const kind = evidence[1].toLowerCase();
    if (!['parity', 'stack'].includes(kind)) {
      errors.push(`${location}: @evidence must be either "parity" or "stack".`);
      continue;
    }

    if (!followsTestDeclaration(source.slice(match.index + block.length))) {
      errors.push(
        `${location}: evidence metadata must immediately precede an it(...) or test(...) case.`
      );
    }

    if (kind === 'stack') {
      stackDeclarations++;
      if (!/@contract\s+\S/.test(block)) {
        errors.push(`${location}: stack evidence requires a non-empty @contract.`);
      }
      continue;
    }

    parityDeclarations++;
    if (!/@assertion\s+\S/.test(block)) {
      errors.push(`${location}: parity evidence requires a non-empty @assertion.`);
    }

    const references = [...block.matchAll(referencePattern)];
    if (references.length === 0) {
      errors.push(
        `${location}: parity evidence requires @reference reference/freeciv/...:start-end or reference/freeciv-web/...:start-end.`
      );
      continue;
    }

    for (const reference of references) {
      const [, referencePath, startText, endText] = reference;
      const start = Number(startText);
      const end = Number(endText ?? startText);
      const absolutePath = join(process.cwd(), referencePath);

      try {
        const totalLines = await lineCount(absolutePath);
        if (start < 1 || end < start || end > totalLines) {
          errors.push(
            `${location}: ${referencePath}:${start}-${end} is outside the reference file.`
          );
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          errors.push(`${location}: referenced file does not exist: ${referencePath}.`);
        } else {
          throw error;
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Invalid test evidence declarations:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(
    `Verified test evidence declarations in ${testFiles.length} test files: ${parityDeclarations} parity, ${stackDeclarations} stack.`
  );
}
