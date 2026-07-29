import { spawnSync } from 'node:child_process';

const composeArgs = ['compose', '-f', 'docker-compose.test.yml'];
const testDatabaseUrl = 'postgresql://civjs:civjs_secret@127.0.0.1:55432/civjs_test';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let exitCode = 1;
try {
  const startup = run('docker', [...composeArgs, 'up', '-d', '--wait']);
  if (startup !== 0) process.exitCode = startup;
  else {
    exitCode = run('npm', ['run', 'test:integration:direct'], {
      env: { ...process.env, TEST_DATABASE_URL: testDatabaseUrl },
    });
    process.exitCode = exitCode;
  }
} finally {
  const cleanup = run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans']);
  if (cleanup !== 0 && exitCode === 0) process.exitCode = cleanup;
}
