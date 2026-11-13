import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Buffer } from 'node:buffer';
import { lstat, open } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  checkPackageVersions,
  readVersion,
  readVersionHistory,
  repositoryRoot,
} from './version.mjs';

const execute = promisify(execFile);
async function runGitHub(args) {
  try {
    const { stdout, stderr } = await execute('gh', args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    return {
      status: 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr || error.message,
    };
  }
}
async function command(run, args) {
  const result = await run(args);
  if (result.status !== 0)
    throw new Error(result.stderr || 'GitHub command failed.');
  return result.stdout;
}
async function resource(run, path) {
  const result = await run(['api', path]);
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/\bHTTP 404\b/.test(result.stderr)) return null;
  throw new Error(result.stderr || 'GitHub lookup failed.');
}
async function findRelease(run, repo, tag) {
  const published = await resource(run, `repos/${repo}/releases/tags/${tag}`);
  if (published) return published;
  const [owner, name] = repo.split('/');
  const result = JSON.parse(
    await command(run, [
      'api',
      'graphql',
      '-f',
      'query=query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){databaseId}}}',
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-f',
      `tag=${tag}`,
    ]),
  );
  if (result.errors || !result.data?.repository)
    throw new Error('GitHub draft lookup failed.');
  const id = result.data.repository.release?.databaseId;
  if (id == null) return null;
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error('Invalid release identity.');
  const release = await resource(run, `repos/${repo}/releases/${id}`);
  if (!release || release.tag_name !== tag)
    throw new Error('Release identity changed.');
  return release;
}
function validate({ repo, sha, version }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? ''))
    throw new Error('A repository owner/name is required.');
  if (!/^[0-9a-f]{40}$/i.test(sha ?? ''))
    throw new Error('An exact source commit SHA is required.');
  readVersionHistory(`## ${version}\n`);
}
export async function preflightRelease(options, run = runGitHub) {
  validate(options);
  const { repo, sha, version } = options;
  const tag = `v${version}`;
  const release = await findRelease(run, repo, tag);
  if (release && !release.draft)
    throw new Error(
      `${tag} is already published. Request a new explicit version; published assets will not be replaced.`,
    );
  const ref = await resource(run, `repos/${repo}/git/ref/tags/${tag}`);
  let object = ref?.object;
  for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) {
    const annotated = await resource(
      run,
      `repos/${repo}/git/tags/${object.sha}`,
    );
    object = annotated?.object;
  }
  if (ref && (object?.type !== 'commit' || object.sha !== sha))
    throw new Error(`${tag} belongs to another commit.`);
  if (release && !ref && release.target_commitish !== sha)
    throw new Error(`Draft ${tag} belongs to another commit.`);
  return { tag, release };
}
export async function publishRelease(options, run = runGitHub) {
  validate(options);
  const name = `CopilotSessionDashboard-${options.version}-win-x64.zip`;
  if (!options.zip || basename(options.zip) !== name)
    throw new Error(`ZIP must be named ${name}.`);
  const info = await lstat(options.zip);
  if (!info.isFile() || info.size < 4)
    throw new Error('ZIP must be a nonempty regular file.');
  const archive = await open(options.zip, 'r');
  try {
    const header = Buffer.alloc(4);
    await archive.read(header, 0, 4, 0);
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
      throw new Error('Invalid ZIP signature.');
  } finally {
    await archive.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(options.zip)) hash.update(chunk);
  const digest = `sha256:${hash.digest('hex')}`;
  const { tag, release } = await preflightRelease(options, run);
  const { repo, sha, notes } = options;
  if (!release) {
    await command(run, [
      'release',
      'create',
      tag,
      '--repo',
      repo,
      '--target',
      sha,
      '--draft',
      '--title',
      `Copilot Session Dashboard ${tag}`,
      '--notes',
      notes ?? '',
    ]);
  }
  const current = await preflightRelease(options, run);
  if (!current.release?.draft || (release && current.release.id !== release.id))
    throw new Error('Draft release identity changed.');
  const existing = current.release.assets?.find((asset) => asset.name === name);
  if (
    existing &&
    (existing.digest !== digest ||
      existing.size !== info.size ||
      existing.state !== 'uploaded')
  )
    throw new Error('Conflicting draft ZIP; assets are never overwritten.');
  if (!existing)
    await command(run, ['release', 'upload', tag, options.zip, '--repo', repo]);
  const uploaded = await findRelease(run, repo, tag);
  if (
    !uploaded?.draft ||
    uploaded.id !== current.release.id ||
    !uploaded.assets?.some((asset) => asset.name === name)
  )
    throw new Error(
      'Release is no longer a draft or the ZIP upload is not confirmed.',
    );
  await command(run, [
    'release',
    'edit',
    tag,
    '--repo',
    repo,
    '--draft=false',
    '--title',
    `Copilot Session Dashboard ${tag}`,
    '--notes',
    notes ?? '',
  ]);
  return { tag, asset: name, sha };
}
async function main() {
  if (process.env.GITHUB_REF && process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Desktop releases can only be published from main.');
  const args = process.argv.slice(2);
  const mode = args.shift();
  if (!['--check', '--publish'].includes(mode) || args.length % 2)
    throw new Error(
      'Use --check|--publish [--repo owner/name] [--sha commit] [--zip path].',
    );
  const flags = {};
  for (let n = 0; n < args.length; n += 2) {
    if (!['--repo', '--sha', '--zip'].includes(args[n]))
      throw new Error(`Unknown option: ${args[n]}`);
    flags[args[n]] = args[n + 1];
  }
  const versionInfo = await readVersion();
  await checkPackageVersions();
  const options = {
    ...versionInfo,
    repo: flags['--repo'] ?? process.env.GITHUB_REPOSITORY,
    sha: flags['--sha'] ?? process.env.GITHUB_SHA,
    zip: flags['--zip']
      ? resolve(flags['--zip'])
      : join(
          repositoryRoot,
          'desktop',
          'artifacts',
          `CopilotSessionDashboard-${versionInfo.version}-win-x64.zip`,
        ),
  };
  const result =
    mode === '--check'
      ? await preflightRelease(options)
      : await publishRelease(options);
  console.log(
    JSON.stringify(
      mode === '--check'
        ? { tag: result.tag, draft: Boolean(result.release) }
        : result,
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
