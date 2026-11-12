import type {
  NormalizedBatch,
  NormalizedRecord,
  RecordBase,
  RecordContext,
} from '../../shared/contracts.js';
import { amounts, number, object, text, time } from './values.js';
import { toAssistantPreview } from './vscode.js';

export function parseCliRecord(
  value: unknown,
  context: RecordContext,
): NormalizedBatch {
  const event = object(value);
  const data = object(event.data);
  const type = text(event.type);
  const base: RecordBase = {
    sourceId: context.sourceId,
    eventId: text(event.id) ?? context.recordId,
    namespace: 'cli',
    sessionRef: context.sessionRef ?? text(data.sessionId) ?? context.sourceId,
    timestamp: time(event.timestamp),
    observedAt: context.observedAt,
    model: text(data.model),
  };
  const records: NormalizedRecord[] = [];
  const warnings: string[] = [];
  if (type === 'session.start') {
    records.push({
      ...base,
      sessionRef: text(data.sessionId) ?? base.sessionRef,
      kind: 'session',
      state: 'unknown',
      directory: text(object(data.context).cwd) ?? undefined,
    });
  } else if (type === 'user.message' && typeof data.content === 'string') {
    records.push({
      ...base,
      kind: 'entry',
      role: 'original-user',
      text: data.content,
      truncated: false,
    });
  } else if (type === 'assistant.message' && typeof data.content === 'string') {
    records.push({
      ...base,
      kind: 'entry',
      role: 'assistant-preview',
      ...toAssistantPreview(data.content),
    });
  } else if (type === 'session.model_change') {
    records.push({ ...base, kind: 'session', model: text(data.newModel) });
  } else if (type === 'session.usage_record') {
    const usage = object(data.usage);
    const end = base.timestamp;
    const duration = number(usage.duration);
    records.push({
      ...base,
      kind: 'usage',
      model: text(usage.responseModel) ?? text(usage.model),
      usage: {
        ...amounts({
          input: number(usage.inputTokens),
          output: number(usage.outputTokens),
          cacheRead: number(usage.cacheReadTokens),
          cacheWrite: number(usage.cacheWriteTokens),
          reasoning: number(usage.reasoningTokens),
        }),
        id:
          text(usage.apiCallId) ??
          text(object(usage.accounting).usageId) ??
          base.eventId,
        model: text(usage.responseModel) ?? text(usage.model),
        scope: 'call',
        origin: 'cli-history',
        start:
          duration !== null && end !== null
            ? Math.max(0, end - duration)
            : null,
        end,
      },
    });
    warnings.push(
      'Reported AI credits are unavailable: the native billing-unit mapping has not been verified.',
    );
  } else if (type === 'assistant.turn_start' || type === 'assistant.turn_end') {
    const start = type.endsWith('start');
    records.push({
      ...base,
      kind: 'activity',
      label: start ? 'Model turn started' : 'Model turn ended',
      operation: 'turn',
      operationId: text(data.turnId) ?? undefined,
      phase: start ? 'start' : 'end',
    });
    if (start && !event.agentId)
      records.push({
        ...base,
        eventId: `${base.eventId}:state`,
        kind: 'session',
        state: 'active',
        stateScope: 'turn',
      });
  } else if (
    type === 'tool.execution_start' ||
    type === 'tool.execution_complete'
  ) {
    records.push({
      ...base,
      kind: 'activity',
      label: type.endsWith('start')
        ? `Tool started: ${text(data.toolName) ?? 'tool'}`
        : data.success === false
          ? 'Tool failed'
          : 'Tool completed',
      operation: 'tool',
      operationId: text(data.toolCallId) ?? undefined,
      phase: type.endsWith('start')
        ? 'start'
        : data.success === false
          ? 'error'
          : 'end',
    });
  } else if (type === 'assistant.idle' || type === 'session.idle') {
    records.push({
      ...base,
      kind: 'session',
      state: data.aborted === true ? 'interrupted' : 'idle',
      stateScope: type === 'assistant.idle' ? 'turn' : 'session',
    });
  } else if (type === 'session.error') {
    records.push({
      ...base,
      kind: 'activity',
      label: 'Session error observed',
      operation: 'session',
      phase: 'error',
    });
  } else {
    warnings.push(`Event not indexed: ${type ?? 'unknown'}`);
  }
  return { records, warnings };
}
