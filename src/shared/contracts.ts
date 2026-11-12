export type SessionState =
  'active' | 'idle' | 'completed' | 'interrupted' | 'error' | 'unknown';
export type Coverage = 'complete' | 'partial' | 'unavailable';
export type SourceKind =
  'cli-history' | 'vscode-import' | 'cli-telemetry' | 'vscode-telemetry';
export type MetricKey =
  'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning' | 'aic';
export type Amounts = Record<MetricKey, number | null>;
export type SourceConfig = {
  id: string;
  kind: SourceKind;
  path: string;
  enabled: boolean;
};
export type RecordContext = {
  sourceId: string;
  recordId: string;
  observedAt: number;
  sessionRef?: string;
};
export type ImportContext = {
  sourceId: string;
  contentHash: string;
  importedAt: number;
};
export type UsageObservation = Amounts & {
  id: string;
  sessionKey?: string;
  scope: 'call' | 'invocation' | 'session';
  origin: SourceKind;
  model: string | null;
  parentId?: string;
  start: number | null;
  end: number | null;
  authoritative?: boolean;
  coverage?: Partial<Record<MetricKey, Coverage>>;
  combinedEligible?: boolean;
};
export type RecordBase = {
  sourceId: string;
  eventId: string;
  sessionRef: string;
  namespace: 'cli' | 'vscode' | 'vscode-export';
  timestamp: number | null;
  observedAt: number;
  model: string | null;
};
export type NormalizedRecord = RecordBase &
  (
    | {
        kind: 'session';
        title?: string;
        state?: SessionState;
        stateScope?: 'session' | 'turn';
        snapshot?: boolean;
        directory?: string;
        repository?: string;
      }
    | {
        kind: 'entry';
        role: 'original-user' | 'assistant-preview' | 'captured-context';
        text: string;
        truncated: boolean;
        requestId?: string;
      }
    | {
        kind: 'activity';
        label: string;
        phase: 'start' | 'end' | 'info' | 'error';
        operation: 'model' | 'tool' | 'session' | 'turn';
        operationId?: string;
      }
    | { kind: 'usage'; usage: UsageObservation }
  );
export type NormalizedBatch = {
  records: NormalizedRecord[];
  warnings: string[];
};
export type Page<T> = {
  items: T[];
  total: number;
  offset: number;
  limit: number;
};
export type SessionFilter = {
  query?: string;
  hideEmptyPreviews?: boolean;
  entryOrder?: 'asc' | 'desc';
  source?: string;
  state?: SessionState;
  model?: string;
  from?: number;
  to?: number;
  sort: 'lastActivity' | 'agentTime' | 'credits';
  offset: number;
  limit: number;
};
export type ModelUsage = Amounts & {
  model: string;
  calls: number;
  inferenceMs: number | null;
};
export type UsageSummary = Amounts & {
  coverage: Record<MetricKey, Coverage>;
  agentMs: number | null;
  wallMs: number | null;
  models: ModelUsage[];
  warnings: string[];
  cacheShare: number | null;
  cacheShareInput?: number | null;
  cacheShareRead?: number | null;
};
export type SessionSummary = {
  id: string;
  title: string;
  sourceIds: string[];
  sourceKinds: SourceKind[];
  models: string[];
  state: SessionState;
  stateScope: 'session' | 'turn';
  snapshot: boolean;
  firstAt: number | null;
  lastAt: number | null;
  observedAt: number;
  directory: string | null;
  repository: string | null;
  usage: UsageSummary;
  matchedEntryId?: string;
  matchedEntryOffset?: number;
};
export type ConversationEntry = {
  id: string;
  role: 'original-user' | 'assistant-preview';
  text: string;
  truncated: boolean;
  timestamp: number | null;
  model: string | null;
  requestId?: string;
};
export type ActivityEntry = {
  id: string;
  label: string;
  phase: 'start' | 'end' | 'info' | 'error';
  operation: 'model' | 'tool' | 'session' | 'turn';
  timestamp: number | null;
  observedAt: number;
};
export type SessionDetails = {
  summary: SessionSummary;
  warnings: string[];
  counts: { modelCalls: number; toolCalls: number };
};
export type SourceStatus = SourceConfig & {
  lastSuccessAt: number | null;
  error: string | null;
  warnings: string[];
  capabilities: {
    history: boolean;
    content: boolean;
    usage: boolean;
    activity: boolean;
  };
};
export type StoreChange = { sessionIds: string[]; sourceIds: string[] };
export type AppInfo = {
  dataDirectory: string;
  defaultCliRoot: string;
  privacyWarning: string | null;
};
export type UsageReport = {
  totals: UsageSummary;
  models: ModelUsage[];
  sources: { source: string; usage: UsageSummary }[];
  sessions: number;
  missing: number;
  partial: number;
  excluded: number;
};
