#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [command, archiveArgument] = process.argv.slice(2);
const archivePath = resolve(archiveArgument || 'civjs-backup.dump');
const checksumPath = `${archivePath}.sha256`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) fail(`${program} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${program} exited with status ${result.status}`);
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function requireUrl(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

if (!['create', 'verify'].includes(command)) {
  fail('Usage: node tools/postgres-backup.mjs <create|verify> [archive.dump]');
}

if (command === 'create') {
  const sourceUrl = requireUrl('DATABASE_URL');
  if (existsSync(archivePath) || existsSync(checksumPath)) {
    fail(`Refusing to overwrite an existing backup or checksum: ${archivePath}`);
  }
  run('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    archivePath,
    sourceUrl,
  ]);
  const digest = await sha256(archivePath);
  writeFileSync(checksumPath, `${digest}  ${archivePath}\n`, { flag: 'wx' });
  process.stdout.write(`Created ${archivePath} and ${checksumPath}\n`);
  process.exit(0);
}

if (!existsSync(archivePath) || !existsSync(checksumPath)) {
  fail(`Backup archive and checksum are required: ${archivePath}`);
}
const expectedChecksum = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
const actualChecksum = await sha256(archivePath);
if (expectedChecksum !== actualChecksum) fail('Backup checksum mismatch');

const sourceUrl = process.env.DATABASE_URL;
const verifyUrl = requireUrl('VERIFY_DATABASE_URL');
if (sourceUrl && sourceUrl === verifyUrl) {
  fail('VERIFY_DATABASE_URL must not be the source DATABASE_URL');
}
if (process.env.CONFIRM_REPLACE_VERIFY_DATABASE !== 'yes') {
  fail('Set CONFIRM_REPLACE_VERIFY_DATABASE=yes to replace the isolated verification database');
}

run('pg_restore', [
  '--clean',
  '--if-exists',
  '--no-owner',
  '--no-privileges',
  '--dbname',
  verifyUrl,
  archivePath,
]);
run('psql', [
  verifyUrl,
  '--set',
  'ON_ERROR_STOP=1',
  '--command',
  'SELECT count(*) AS applied_migrations FROM drizzle.__drizzle_migrations;',
  '--command',
  'SELECT count(*) AS games FROM public.games;',
]);
process.stdout.write(`Verified checksum and restored ${archivePath} into the isolated database\n`);
