import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
export function readVersionHistory(text) {
  const headings = [...text.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  if (!headings.length) throw new Error('Missing version entry in VERSION.md.');
  const versions = headings.map((heading) => heading[1].trim());
  for (const version of versions) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
      throw new Error(`Invalid application version: ${version}`);
  }
  if (new Set(versions).size !== versions.length)
    throw new Error('Duplicate version entry in VERSION.md.');
  const start = headings[0].index + headings[0][0].length;
  const end = headings[1]?.index ?? text.length;
  return { version: versions[0], notes: text.slice(start, end).trim() };
}
export async function readVersion(root = repositoryRoot) {
  return readVersionHistory(await readFile(join(root, 'VERSION.md'), 'utf8'));
}
async function metadata(root) {
  const files = ['package.json', 'package-lock.json'];
  return Promise.all(
    files.map(async (name) => ({
      path: join(root, name),
      value: JSON.parse(await readFile(join(root, name), 'utf8')),
    })),
  );
}
export async function checkPackageVersions(root = repositoryRoot) {
  const { version } = await readVersion(root);
  const [manifest, lock] = await metadata(root);
  if (
    manifest.value.version !== version ||
    lock.value.version !== version ||
    lock.value.packages?.['']?.version !== version
  )
    throw new Error(
      'Version metadata disagrees with VERSION.md. Run npm run version:sync after an explicit version update.',
    );
  return version;
}
export async function syncPackageVersions(root = repositoryRoot) {
  const { version } = await readVersion(root);
  const [manifest, lock] = await metadata(root);
  if (!lock.value.packages?.[''])
    throw new Error('Missing root package-lock metadata.');
  for (const file of [manifest, lock]) {
    const changed =
      file.value.version !== version ||
      (file === lock && lock.value.packages[''].version !== version);
    file.value.version = version;
    if (file === lock) file.value.packages[''].version = version;
    if (changed)
      await writeFile(file.path, JSON.stringify(file.value, null, 2) + '\n');
  }
  return version;
}
async function main() {
  const args = process.argv.slice(2);
  let root = repositoryRoot;
  const rootIndex = args.indexOf('--root');
  if (rootIndex !== -1) {
    if (!args[rootIndex + 1]) throw new Error('--root requires a directory.');
    root = resolve(args[rootIndex + 1]);
    args.splice(rootIndex, 2);
  }
  if (args[0] === '--native') {
    const version = await checkPackageVersions(root);
    const expected = [
      version,
      version,
      `${version}.0`,
      `${version}.0`,
      version,
    ];
    if (
      args.length !== 6 ||
      expected.some((value, index) => args[index + 1] !== value)
    )
      throw new Error('Native version overrides must agree with VERSION.md.');
    console.log(version);
    return;
  }
  if (args.length !== 1 || !['--json', '--check', '--sync'].includes(args[0]))
    throw new Error(
      'Usage: node scripts\\version.mjs [--root directory] --json|--check|--sync',
    );
  if (args[0] === '--json')
    console.log(JSON.stringify(await readVersion(root)));
  else if (args[0] === '--sync') console.log(await syncPackageVersions(root));
  else console.log(await checkPackageVersions(root));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
