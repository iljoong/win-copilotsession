import { createHash } from 'node:crypto';
import type {
  ImportContext,
  NormalizedBatch,
  NormalizedRecord,
  RecordBase,
} from '../../shared/contracts.js';
import { amounts, number, object, text, time } from './values.js';

export function toAssistantPreview(value: string) {
  const characters = Array.from(value);
  return {
    text: characters.slice(0, 1000).join(''),
    truncated: characters.length > 1000,
  };
}

export function parseVsCodeExport(
  value: unknown,
  context: ImportContext,
): NormalizedBatch {
  const root = object(value);
  const requests = root.requests;
  if (
    typeof root.responderUsername !== 'string' ||
    !Array.isArray(requests) ||
    requests.some((raw) => {
      const request = object(raw);
      return (
        typeof request.requestId !== 'string' ||
        (typeof request.message !== 'string' &&
          typeof object(request.message).text !== 'string') ||
        (request.response !== undefined && !Array.isArray(request.response))
      );
    })
  ) {
    return {
      records: [],
      warnings: [
        'Unsupported VS Code chat export. Use Chat: Export Chat... to create JSON.',
      ],
    };
  }
  const fingerprint = createHash('sha256')
    .update(context.contentHash)
    .digest('hex');
  const base: RecordBase = {
    sourceId: context.sourceId,
    eventId: 'snapshot',
    namespace: 'vscode-export',
    sessionRef: fingerprint,
    timestamp: time(root.creationDate),
    observedAt: context.importedAt,
    model: null,
  };
  const records: NormalizedRecord[] = [
    {
      ...base,
      kind: 'session',
      state: 'unknown',
      snapshot: true,
      title: text(root.customTitle) ?? undefined,
    },
  ];
  for (const raw of requests) {
    const request = object(raw);
    const id = request.requestId as string;
    const current = {
      ...base,
      timestamp: time(request.timestamp),
      model: text(request.modelId),
    };
    if (
      !request.isSystemInitiated &&
      !request.hiddenFromTranscript &&
      !request.requestHiddenFromTranscript
    ) {
      records.push({
        ...current,
        eventId: `${id}:user`,
        kind: 'entry',
        role: 'original-user',
        text: text(request.message) ?? text(object(request.message).text)!,
        truncated: false,
        requestId: id,
      });
    }
    const response = (Array.isArray(request.response) ? request.response : [])
      .flatMap((rawPart) => {
        const part = object(rawPart);
        if (part.kind === 'markdownContent')
          return text(object(part.content).value) ?? [];
        if (!part.kind && typeof part.value === 'string') return part.value;
        return [];
      })
      .join('\n\n');
    if (response)
      records.push({
        ...current,
        eventId: `${id}:assistant`,
        kind: 'entry',
        role: 'assistant-preview',
        ...toAssistantPreview(response),
        requestId: id,
      });
    const credits = number(request.copilotCredits);
    if (credits !== null)
      records.push({
        ...current,
        eventId: `${id}:usage`,
        kind: 'usage',
        usage: {
          ...amounts({ aic: credits }),
          id,
          model: current.model,
          origin: 'vscode-import',
          scope: 'invocation',
          start: null,
          end: null,
          combinedEligible: false,
          coverage: { aic: 'partial' },
        },
      });
  }
  return {
    records,
    warnings: [
      'Imported snapshot; native session identity and live status are unavailable. Original text only; attachments are not copied.',
      'Export schema checked against VS Code 1.146.0 source; a real export from this installation has not been validated.',
      'Snapshot usage is excluded from combined totals without verified cross-source identity.',
    ],
  };
}
