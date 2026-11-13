import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

type Result = { status: number; stdout: string; stderr: string };
type Run = (args: string[]) => Promise<Result>;
type Options = {
  repo: string;
  sha: string;
  version: string;
  notes?: string;
  zip?: string;
};
const source = {
  repo: 'example/project',
  sha: 'a'.repeat(40),
  version: '0.1.0',
};
const roots: string[] = [];
async function tools() {
  const path = '../scripts/release-desktop.mjs';
  return (await import(path)) as {
    preflightRelease: (options: Options, run: Run) => Promise<unknown>;
    publishRelease: (options: Options, run: Run) => Promise<unknown>;
  };
}
async function zip(name = 'CopilotSessionDashboard-0.1.0-win-x64.zip') {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-release-'));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, 'PK\u0003\u0004synthetic archive boundary');
  return path;
}
function github(
  initial: 'none' | 'draft' | 'published' = 'none',
  tagSha: string | null = null,
) {
  const state = {
    tagSha,
    release:
      initial === 'none'
        ? null
        : {
            draft: initial === 'draft',
            assets: [] as {
              name: string;
              digest?: string;
              size?: number;
              state?: string;
            }[],
            body: '',
            id: 1,
            tag_name: 'v0.1.0',
            target_commitish: source.sha,
          },
    failUpload: false,
    failRead: false,
    publishBeforeUpload: false,
  };
  const ok = (value: unknown = ''): Result => ({
    status: 0,
    stdout: typeof value === 'string' ? value : JSON.stringify(value),
    stderr: '',
  });
  const missing = (): Result => ({ status: 1, stdout: '', stderr: 'HTTP 404' });
  const run: Run = async (args) => {
    if (args[0] === 'api' && state.failRead)
      return { status: 1, stdout: '', stderr: 'HTTP 403: permission denied' };
    if (args[0] === 'api' && args[1] === 'graphql')
      return ok({
        data: {
          repository: { release: state.release ? { databaseId: 1 } : null },
        },
      });
    if (args[0] === 'api' && args[1].endsWith('/releases/1'))
      return state.release ? ok(state.release) : missing();
    if (args[0] === 'api' && args[1].includes('/releases/tags/'))
      return state.release && !state.release.draft
        ? ok(state.release)
        : missing();
    if (args[0] === 'api' && args[1].includes('/git/ref/tags/'))
      return state.tagSha
        ? ok({ object: { sha: state.tagSha, type: 'commit' } })
        : missing();
    if (args[0] === 'api' && args[1].includes('/commits/'))
      return state.tagSha
        ? ok({ sha: state.tagSha })
        : { status: 1, stdout: '', stderr: 'No commit found (HTTP 422)' };
    if (args[0] === 'release' && args[1] === 'create') {
      state.release = {
        draft: args.includes('--draft'),
        assets: [],
        body: args[args.indexOf('--notes') + 1],
        id: 1,
        tag_name: 'v0.1.0',
        target_commitish: args[args.indexOf('--target') + 1],
      };
      return ok();
    }
    if (args[0] === 'release' && args[1] === 'upload') {
      if (state.publishBeforeUpload) {
        state.release!.draft = false;
        state.release!.assets = [{ name: basename(args[3]) }];
        if (args.includes('--clobber')) state.release!.assets = [];
      }
      if (state.failUpload)
        return { status: 1, stdout: '', stderr: 'Upload failed' };
      state.release!.assets = [{ name: basename(args[3]) }];
      return ok();
    }
    if (args[0] === 'release' && args[1] === 'edit') {
      if (!state.release?.assets.length)
        throw new Error('Cannot publish an empty release');
      state.release.draft = false;
      state.tagSha = state.release.target_commitish;
      return ok();
    }
    throw new Error(`Unexpected GitHub operation: ${args.join(' ')}`);
  };
  return { state, run };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
test('firstReleaseAllowsAbsentTagWithoutMaskingCommitValidationErrors', async () => {
  const { preflightRelease } = await tools();
  await expect(preflightRelease(source, github().run)).resolves.toMatchObject({
    tag: 'v0.1.0',
    release: null,
  });
});
test('publishedVersionsCannotBeReplaced', async () => {
  const { preflightRelease } = await tools();
  const { run, state } = github('published', source.sha);
  await expect(preflightRelease(source, run)).rejects.toThrow(
    'already published',
  );
  expect(state.release!.draft).toBe(false);
  expect(state.release!.assets).toEqual([]);
});
test.each(['draft', 'none'] as const)(
  'foreignCommitTagCannotBePublished %s',
  async (initial) => {
    const { preflightRelease } = await tools();
    await expect(
      preflightRelease(source, github(initial, 'b'.repeat(40)).run),
    ).rejects.toThrow('another commit');
  },
);
test('uploadFailureLeavesDraftAndSameCommitRetryPublishesAttachedZip', async () => {
  const { publishRelease } = await tools();
  const { state, run } = github();
  const options = {
    ...source,
    notes: 'Explicit initial release.',
    zip: await zip(),
  };
  state.failUpload = true;
  await expect(publishRelease(options, run)).rejects.toThrow('Upload failed');
  expect(state.release!.draft).toBe(true);
  expect(state.release!.assets).toEqual([]);
  expect(state.tagSha).toBeNull();
  expect(state.release!.target_commitish).toBe(source.sha);
  state.failUpload = false;
  await publishRelease(options, run);
  expect(state.release).toEqual({
    draft: false,
    assets: [{ name: 'CopilotSessionDashboard-0.1.0-win-x64.zip' }],
    body: 'Explicit initial release.',
    id: 1,
    tag_name: 'v0.1.0',
    target_commitish: source.sha,
  });
});
test('pendingTagDraftRejectsMovingOrForeignTarget', async () => {
  const { preflightRelease } = await tools();
  const { state, run } = github('draft');
  state.release!.target_commitish = 'main';
  await expect(preflightRelease(source, run)).rejects.toThrow('another commit');
});
test('externalPublicationCannotCausePublishedAssetDeletionOnUploadFailure', async () => {
  const { publishRelease } = await tools();
  const { state, run } = github();
  state.publishBeforeUpload = true;
  state.failUpload = true;
  await expect(
    publishRelease({ ...source, zip: await zip() }, run),
  ).rejects.toThrow();
  expect(state.release!.draft).toBe(false);
  expect(state.release!.assets).toEqual([
    { name: 'CopilotSessionDashboard-0.1.0-win-x64.zip' },
  ]);
});
test('permissionFailureIsNotTreatedAsAMissingRelease', async () => {
  const { preflightRelease } = await tools();
  const { state, run } = github();
  state.failRead = true;
  await expect(preflightRelease(source, run)).rejects.toThrow('HTTP 403');
  expect(state.release).toBeNull();
});
test.each([true, false])(
  'completedDraftAssetIsReusedOnlyWhenItMatches %s',
  async (matches) => {
    const { publishRelease } = await tools();
    const { state, run } = github('draft');
    const path = await zip();
    const content = await readFile(path);
    state.release!.assets = [
      {
        name: basename(path),
        digest:
          'sha256:' +
          createHash('sha256')
            .update(matches ? content : 'other ZIP')
            .digest('hex'),
        size: content.length,
        state: 'uploaded',
      },
    ];
    state.failUpload = true;
    const result = publishRelease({ ...source, zip: path }, run);
    if (matches) {
      await expect(result).resolves.toMatchObject({ tag: 'v0.1.0' });
      expect(state.release!.draft).toBe(false);
    } else {
      await expect(result).rejects.toThrow('Conflicting draft ZIP');
      expect(state.release!.draft).toBe(true);
    }
  },
);
test('wrongVersionAssetIsRejectedBeforeCreatingARelease', async () => {
  const { publishRelease } = await tools();
  const { state, run } = github();
  await expect(
    publishRelease(
      { ...source, notes: 'Initial.', zip: await zip('wrong-version.zip') },
      run,
    ),
  ).rejects.toThrow('ZIP');
  expect(state.release).toBeNull();
});
