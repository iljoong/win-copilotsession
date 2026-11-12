import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCliRecord } from '../src/server/sources/cli.js';
import {
  parseVsCodeExport,
  toAssistantPreview,
} from '../src/server/sources/vscode.js';
import { parseTelemetryRecord } from '../src/server/sources/telemetry.js';

const context = {
  sourceId: 'test',
  recordId: 'test-record',
  observedAt: 1000,
  sessionRef: 'demo-cli',
};
const cli = readFileSync(
  new URL('./fixtures/cli-events.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const vscode = JSON.parse(
  readFileSync(
    new URL('./fixtures/vscode-export.json', import.meta.url),
    'utf8',
  ),
);

test('originalPromptsAreNotExpandedModelContext', () => {
  const result = parseCliRecord(cli[1], context);
  expect(
    result.records.find((record) => record.kind === 'entry'),
  ).toMatchObject({
    role: 'original-user',
    text: 'Preserve retry cancellation.',
  });
  expect(JSON.stringify(result)).not.toContain('Expanded context');
});

test('previewExcludesToolsAndReasoning', () => {
  const result = parseVsCodeExport(vscode, {
    sourceId: 'import',
    contentHash: 'abc',
    importedAt: 2000,
  });
  expect(
    result.records
      .filter((record) => record.kind === 'entry')
      .map((record) => record.text),
  ).toEqual([
    'Preserve retry cancellation.',
    'The retry loop now checks cancellation.',
  ]);
  expect(JSON.stringify(parseCliRecord(cli[2], context))).not.toContain(
    'Private reasoning',
  );
});

test('previewCapsAt1000CodePoints', () => {
  const result = toAssistantPreview('😀'.repeat(1001));
  expect(Array.from(result.text)).toHaveLength(1000);
  expect(result.truncated).toBe(true);
});

test('unknownFieldsRemainUnavailable', () => {
  const result = parseCliRecord(cli[3], context);
  expect(
    result.records.find((record) => record.kind === 'usage')?.usage,
  ).toMatchObject({
    input: 100,
    output: 20,
    cacheRead: 60,
    aic: null,
  });
});
test.each([
  [2_500_000_000, 'complete', 2.5, 'complete'],
  [0, 'complete', 0, 'complete'],
  [1_000_000_000, 'partial', 1, 'partial'],
  [null, 'complete', null, 'unavailable'],
  [-1, 'complete', null, 'unavailable'],
  ['1000000000', 'complete', null, 'unavailable'],
  [1_000_000_000, 'unavailable', null, 'unavailable'],
])(
  'CLI nano-AIU %s (%s) preserves reported credit coverage',
  (nanoAiu, status, aic, coverage) => {
    const result = parseCliRecord(
      {
        type: 'session.usage_record',
        data: {
          usage: {
            cost: 99,
            aiCreditsStatus: status,
            copilotUsage: { totalNanoAiu: nanoAiu },
          },
        },
      },
      context,
    );
    expect(
      result.records.find((record) => record.kind === 'usage')?.usage,
    ).toMatchObject({ aic, coverage: { aic: coverage } });
  },
);
test('telemetryReadsNanoAiuWithoutTreatingPremiumRequestCostAsCredits', () => {
  const result = parseTelemetryRecord(
    {
      name: 'chat model',
      spanId: 'call',
      attributes: {
        'gen_ai.conversation.id': 'session',
        'gen_ai.operation.name': 'chat',
        'github.copilot.nano_aiu': 1_250_000_000,
        'github.copilot.cost': 99,
      },
    },
    context,
    'cli',
  );
  expect(
    result.records.find((record) => record.kind === 'usage')?.usage.aic,
  ).toBe(1.25);
});

test('snapshotDoesNotMeanCompleted', () => {
  const result = parseVsCodeExport(vscode, {
    sourceId: 'import',
    contentHash: 'abc',
    importedAt: 2000,
  });
  expect(
    result.records.find((record) => record.kind === 'session'),
  ).toMatchObject({
    state: 'unknown',
    snapshot: true,
  });
});

test('turnEndDoesNotMeanSessionCompleted', () => {
  const result = parseCliRecord(
    {
      id: 'end',
      type: 'assistant.turn_end',
      data: {},
      timestamp: '2026-11-12T00:00:04Z',
    },
    context,
  );
  expect(
    result.records.some(
      (record) => record.kind === 'session' && record.state === 'completed',
    ),
  ).toBe(false);
  expect(result.records.some((record) => record.kind === 'activity')).toBe(
    true,
  );
});

test('unknownEventDoesNotDiscardSession', () => {
  const result = parseCliRecord(
    { id: 'future', type: 'future.event', data: {} },
    context,
  );
  expect(result.warnings.length).toBeGreaterThan(0);
  expect(parseCliRecord(cli[1], context).records).toHaveLength(1);
});

test('modelChangesArePreserved', () => {
  const result = parseCliRecord(
    {
      id: 'change',
      type: 'session.model_change',
      data: { newModel: 'second-model' },
    },
    context,
  );
  expect(result.records[0]).toMatchObject({ model: 'second-model' });
});

test('unsupportedExportIsRejectedWithoutPartialImport', () => {
  const result = parseVsCodeExport(
    { requests: [{ message: 5 }] },
    { sourceId: 'import', contentHash: 'abc', importedAt: 1000 },
  );
  expect(result.records).toEqual([]);
  expect(result.warnings.join(' ')).toMatch(/unsupported/i);
});

test.each(['cli', 'vscode'] as const)(
  'completed %s spans expose usage but not active state',
  (client) => {
    const value = JSON.parse(
      readFileSync(
        new URL(`./fixtures/${client}-telemetry.jsonl`, import.meta.url),
        'utf8',
      ),
    );
    const result = parseTelemetryRecord(value, context, client);
    expect(
      result.records.find((record) => record.kind === 'usage')?.usage,
    ).toMatchObject({ input: 100, output: 20 });
    expect(
      result.records.some(
        (record) => record.kind === 'session' && record.state === 'active',
      ),
    ).toBe(false);
  },
);

test('telemetryInputIsNotIndexedAsAnOriginalPrompt', () => {
  const result = parseTelemetryRecord(
    {
      name: 'chat model',
      spanId: 's',
      attributes: {
        'gen_ai.conversation.id': 'session',
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages':
          '[{"role":"user","content":"expanded context"}]',
      },
    },
    context,
    'vscode',
  );
  expect(
    result.records.some(
      (record) => record.kind === 'entry' && record.role === 'original-user',
    ),
  ).toBe(false);
});
