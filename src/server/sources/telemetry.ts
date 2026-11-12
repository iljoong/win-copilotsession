import type {
  NormalizedBatch,
  NormalizedRecord,
  RecordBase,
  RecordContext,
} from '../../shared/contracts.js';
import { amounts, number, object, text } from './values.js';
import { toAssistantPreview } from './vscode.js';

function spanTime(value: unknown): number | null {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'number')
  ) {
    return value[0] * 1000 + value[1] / 1e6;
  }
  if (typeof value === 'string' && /^\d+$/.test(value))
    return Number(BigInt(value) / 1000000n);
  return number(value);
}
function attributes(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return object(value);
  return Object.fromEntries(
    value.map((item) => {
      const attribute = object(item);
      const v = object(attribute.value);
      return [
        attribute.key,
        v.stringValue ??
          (v.intValue !== undefined
            ? Number(v.intValue)
            : (v.doubleValue ?? v.boolValue)),
      ];
    }),
  );
}

export function parseTelemetryRecord(
  value: unknown,
  context: RecordContext,
  client: 'cli' | 'vscode',
): NormalizedBatch {
  const root = object(value);
  if (Array.isArray(root.resourceSpans)) {
    const batches = root.resourceSpans.flatMap((resource) => {
      const scopes = object(resource).scopeSpans;
      return Array.isArray(scopes)
        ? scopes.flatMap((scope) => {
            const spans = object(scope).spans;
            return Array.isArray(spans)
              ? spans.map((span) => parseTelemetryRecord(span, context, client))
              : [];
          })
        : [];
    });
    return {
      records: batches.flatMap((batch) => batch.records),
      warnings: [...new Set(batches.flatMap((batch) => batch.warnings))],
    };
  }
  const span = root.span ? object(root.span) : root;
  const a = attributes(span.attributes);
  const sessionRef = text(a['gen_ai.conversation.id']);
  const id =
    text(span.spanId) ??
    text(object(span._spanContext).spanId) ??
    text(object(span.spanContext).spanId);
  if (!sessionRef || !id)
    return {
      records: [],
      warnings: [
        'Telemetry record has no conversation/span identity; not indexed.',
      ],
    };
  const start = spanTime(span.startTime ?? span.startTimeUnixNano);
  const end = spanTime(span.endTime ?? span.endTimeUnixNano);
  const model =
    text(a['gen_ai.response.model']) ?? text(a['gen_ai.request.model']);
  const operation =
    text(a['gen_ai.operation.name']) ?? text(span.name)?.split(' ')[0];
  const base: RecordBase = {
    sourceId: context.sourceId,
    eventId: id,
    namespace: client,
    sessionRef,
    timestamp: end ?? start,
    observedAt: context.observedAt,
    model,
  };
  const records: NormalizedRecord[] = [
    {
      ...base,
      kind: 'activity',
      label: `${text(span.name) ?? operation ?? 'Operation'} ${end !== null ? 'completed' : 'observed'}`,
      phase: end !== null ? 'end' : 'info',
      operation: operation === 'execute_tool' ? 'tool' : 'model',
      operationId: id,
    },
  ];
  if (operation === 'chat' || operation === 'invoke_agent')
    records.push({
      ...base,
      eventId: `${id}:usage`,
      kind: 'usage',
      usage: {
        ...amounts({
          input: number(a['gen_ai.usage.input_tokens']),
          output: number(a['gen_ai.usage.output_tokens']),
          cacheRead: number(a['gen_ai.usage.cache_read.input_tokens']),
          cacheWrite: number(
            a['gen_ai.usage.cache_creation.input_tokens'] ??
              a['gen_ai.usage.cache_write.input_tokens'],
          ),
          reasoning: number(a['gen_ai.usage.reasoning.output_tokens']),
        }),
        id,
        model,
        scope: operation === 'chat' ? 'call' : 'invocation',
        origin: `${client}-telemetry`,
        start,
        end,
        parentId:
          text(span.parentSpanId) ??
          text(object(span.parentSpanContext).spanId) ??
          undefined,
      },
    });
  const rawOutput = a['gen_ai.output.messages'];
  let output: unknown = rawOutput;
  if (typeof output === 'string') {
    try {
      output = JSON.parse(output);
    } catch {
      output = null;
    }
  }
  if (Array.isArray(output)) {
    const content = output
      .filter((message) => object(message).role === 'assistant')
      .flatMap((message) => {
        const data = object(message);
        if (typeof data.content === 'string') return data.content;
        const parts = Array.isArray(data.parts)
          ? data.parts
          : Array.isArray(data.content)
            ? data.content
            : [];
        return parts.flatMap((part) =>
          object(part).type === 'text' &&
          typeof object(part).content === 'string'
            ? (object(part).content as string)
            : object(part).type === 'text' &&
                typeof object(part).text === 'string'
              ? (object(part).text as string)
              : [],
        );
      })
      .join('\n\n');
    if (content)
      records.push({
        ...base,
        eventId: `${id}:assistant`,
        kind: 'entry',
        role: 'assistant-preview',
        ...toAssistantPreview(content),
      });
  }
  return {
    records,
    warnings: [
      'Telemetry is observed after export; running status and live response streaming are not guaranteed.',
      'Captured model input is not indexed as original user prompts. Billing-unit mapping has not been verified.',
      'Telemetry schema is source-checked; live delivery from this installation has not been measured.',
    ],
  };
}
