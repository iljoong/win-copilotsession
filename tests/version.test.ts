import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const roots: string[] = [];
const script = resolve('scripts', 'version.mjs');
async function fixture(history: string, version = '0.1.0') {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-version-'));
  roots.push(root);
  await writeFile(join(root, 'VERSION.md'), history);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ version, dependencies: { example: '1.0.0' } }),
  );
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({
      version,
      packages: {
        '': { version },
        'node_modules/example': { version: '1.0.0' },
      },
    }),
  );
  return root;
}
function run(root: string, option: string) {
  return spawnSync(process.execPath, [script, '--root', root, option], {
    encoding: 'utf8',
  });
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
test('versionHistorySelectsNewestEntryWithoutChangingHistory', async () => {
  const history =
    '# Version history\n\n## 0.2.0\n\nNew release.\n\n## 0.1.0\n\nInitial release.\n';
  const root = await fixture(history);
  const result = run(root, '--json');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    version: '0.2.0',
    notes: 'New release.',
  });
  expect(await readFile(join(root, 'VERSION.md'), 'utf8')).toBe(history);
});
test.each([
  ['## 0.01.0\n', 'Invalid'],
  ['## 0.1\n', 'Invalid'],
  ['# No version\n', 'Missing'],
  ['## 0.1.0\n\nFirst\n\n## 0.1.0\n', 'Duplicate'],
])('rejectsInvalidOrDuplicateHistory %s', async (history, error) => {
  const result = run(await fixture(history), '--json');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(error);
});
test('explicitSyncUpdatesOnlyProjectedMetadataAndCheckDoesNotWrite', async () => {
  const history =
    '# Version history\n\n## 0.1.1\n\nRequested patch.\n\n## 0.1.0\n\nInitial release.\n';
  const root = await fixture(history);
  const before = await readFile(join(root, 'package.json'), 'utf8');
  const check = run(root, '--check');
  expect(check.status).not.toBe(0);
  expect(check.stderr).toContain('version:sync');
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  const sync = run(root, '--sync');
  expect(sync.status, sync.stderr).toBe(0);
  expect(
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')),
  ).toEqual({
    version: '0.1.1',
    dependencies: { example: '1.0.0' },
  });
  expect(
    JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')),
  ).toEqual({
    version: '0.1.1',
    packages: {
      '': { version: '0.1.1' },
      'node_modules/example': { version: '1.0.0' },
    },
  });
  expect(run(root, '--check').status).toBe(0);
  expect(await readFile(join(root, 'VERSION.md'), 'utf8')).toBe(history);
});
test('nativeBuildMetadataUsesCanonicalVersionAndRejectsConflictingOverride', () => {
  const { version } = JSON.parse(run(resolve('.'), '--json').stdout) as {
    version: string;
  };
  const project = resolve('desktop', 'src', 'Shell', 'Shell.csproj');
  const metadata = spawnSync(
    'dotnet',
    [
      'msbuild',
      project,
      '-nologo',
      '-getProperty:Version,AssemblyVersion,FileVersion,InformationalVersion',
    ],
    { encoding: 'utf8' },
  );
  expect(metadata.status, metadata.stderr).toBe(0);
  expect(JSON.parse(metadata.stdout).Properties).toEqual({
    Version: version,
    AssemblyVersion: `${version}.0`,
    FileVersion: `${version}.0`,
    InformationalVersion: version,
  });
  const conflict = spawnSync(
    'dotnet',
    [
      'msbuild',
      project,
      '-nologo',
      '-target:ValidateApplicationVersion',
      '-p:Version=9.9.9',
    ],
    { encoding: 'utf8' },
  );
  expect(conflict.status).not.toBe(0);
  expect(conflict.stdout + conflict.stderr).toContain('VERSION.md');
  const authorityOverride = spawnSync(
    'dotnet',
    [
      'msbuild',
      project,
      '-nologo',
      '-target:ValidateApplicationVersion',
      '-p:ApplicationVersion=9.9.9',
    ],
    { encoding: 'utf8' },
  );
  expect(authorityOverride.status).not.toBe(0);
  expect(authorityOverride.stdout + authorityOverride.stderr).toContain(
    'VERSION.md',
  );
});
