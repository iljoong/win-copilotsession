import { useEffect, useState } from 'react';
import type { AppInfo, SourceKind, SourceStatus } from '../shared/contracts.js';
import { apiRequest, subscribeChanges } from './api.js';

export function SourcesPage() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [kind, setKind] = useState<SourceKind>('cli-history');
  const [path, setPath] = useState('');
  const [consent, setConsent] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      subscribeChanges(
        () => setVersion((v) => v + 1),
        () => setVersion((v) => v + 1),
      ),
    [],
  );
  useEffect(() => {
    let active = true;
    void apiRequest<AppInfo>('/api/info')
      .then((value) => {
        if (active) {
          setInfo(value);
          setPath(value.defaultCliRoot);
        }
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void apiRequest<SourceStatus[]>('/api/sources')
      .then((value) => {
        if (active) setSources(value);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [version]);
  async function action(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
      setNotice(message);
      setVersion((v) => v + 1);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Operation failed.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    if (file.size > 50 * 1024 * 1024) {
      setError('Choose a JSON export smaller than 50MiB.');
      return;
    }
    await action(async () => {
      const body = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error('Could not read the selected file.'));
        reader.readAsText(file);
      });
      await apiRequest('/api/imports/vscode', { method: 'POST', body });
    }, 'Imported chat snapshot.');
  }
  return (
    <section className="settings-page">
      {info?.privacyWarning && (
        <p role="alert" className="warning">
          {info.privacyWarning}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status" className="notice">
        {notice}
      </p>
      <div className="settings-grid">
        <section className="settings-section">
          <h2>Add a read-only source</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!consent || busy) return;
              void action(async () => {
                await apiRequest(`/api/sources/${crypto.randomUUID()}`, {
                  method: 'PUT',
                  body: JSON.stringify({ kind, path, enabled: true }),
                });
                setConsent(false);
              }, 'Source enabled. Review its status below.');
            }}
          >
            <label>
              Source type
              <select
                disabled={!info}
                value={kind}
                onChange={(event) => {
                  const next = event.target.value as SourceKind;
                  setKind(next);
                  setPath(
                    next === 'cli-history' ? (info?.defaultCliRoot ?? '') : '',
                  );
                  setConsent(false);
                }}
              >
                <option value="cli-history">Copilot CLI history</option>
                <option value="cli-telemetry">
                  Copilot CLI telemetry file
                </option>
                <option value="vscode-telemetry">VS Code telemetry file</option>
              </select>
            </label>
            <label>
              Source path
              <input
                disabled={!info}
                required
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setConsent(false);
                }}
                placeholder="Absolute local path"
                spellCheck={false}
              />
            </label>
            <p className="muted">
              CLI history reads session folders, including session.db TODOs,
              update times and dependency links when you select Todo status.
              Telemetry reads only the file you choose. Source files are never
              modified.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I authorize read-only collection from this path.
            </label>
            <button className="primary" disabled={!consent || !path || busy}>
              Enable source
            </button>
          </form>
        </section>
        <section className="settings-section">
          <h2>Import an existing VS Code chat</h2>
          <p>
            In VS Code, open the conversation and run{' '}
            <strong>Chat: Export Chat...</strong>. Choose its JSON file here.
          </p>
          <label className="file-picker">
            VS Code chat export
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = '';
              }}
            />
          </label>
          <p className="muted">
            Imports are snapshots, not live sessions. Reimporting the same file
            does not duplicate it. Missing model, time, token, or credit fields
            remain unavailable.
          </p>
        </section>
      </div>
      <section className="settings-section">
        <h2>Configured sources</h2>
        {!sources.length && (
          <p className="muted">
            No sources configured. Add CLI history or import a VS Code chat to
            begin.
          </p>
        )}
        {sources.map((source) => (
          <article className="source-row" key={source.id}>
            <header>
              <h3>{source.kind}</h3>
              <span>
                {source.kind === 'vscode-import'
                  ? 'Snapshot'
                  : source.enabled
                    ? 'Enabled'
                    : 'Disabled'}
              </span>
              {source.kind !== 'vscode-import' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        apiRequest(`/api/sources/${source.id}`, {
                          method: 'PUT',
                          body: JSON.stringify({
                            ...source,
                            enabled: !source.enabled,
                          }),
                        }),
                      source.enabled
                        ? 'Source disabled. Saved history remains available.'
                        : 'Source enabled.',
                    )
                  }
                >
                  {source.enabled ? 'Disable' : 'Enable'}
                </button>
              )}
            </header>
            <p className="path">{source.path}</p>
            {source.error && <p className="error">{source.error}</p>}
            <p className="muted">
              Last successful read:{' '}
              {source.lastSuccessAt
                ? new Date(source.lastSuccessAt).toLocaleString()
                : 'Not yet read'}
            </p>
            {source.warnings.length > 0 && (
              <details open={source.kind === 'vscode-import'}>
                <summary>Coverage and compatibility</summary>
                {source.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </details>
            )}
          </article>
        ))}
      </section>
      <section className="settings-section">
        <h2>Collect future activity locally</h2>
        <p>
          Enable file telemetry in each client yourself, then add that file
          above. These instructions do not modify settings or backfill old
          sessions.
        </p>
        <div className="settings-grid">
          <div>
            <h3>Copilot CLI</h3>
            <pre className="setup-code">
              {
                "$env:COPILOT_OTEL_FILE_EXPORTER_PATH = 'C:\\path\\cli-otel.jsonl'\n# Start a new Copilot CLI process from this shell."
              }
            </pre>
            <p className="muted">
              Original prompts come from CLI history. Optional content capture
              uses OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT=SPAN_ONLY and can
              save sensitive expanded context.
            </p>
          </div>
          <div>
            <h3>VS Code</h3>
            <pre className="setup-code">
              {
                '{\n  "github.copilot.chat.otel.enabled": true,\n  "github.copilot.chat.otel.exporterType": "file",\n  "github.copilot.chat.otel.outfile": "C:\\\\path\\\\vscode-otel.jsonl"\n}'
              }
            </pre>
            <p className="muted">
              Settings depend on the active harness. Reload if your client
              requires it. Optional captureContent can record sensitive full
              context; it is not required for usage-only telemetry.
            </p>
          </div>
        </div>
        <p className="warning">
          Telemetry model input is not a reliable original-prompt transcript.
          Import VS Code chat JSON for full prompt search and reuse. Exporters
          may report only after an operation finishes.
        </p>
      </section>
      <section className="settings-section danger-zone">
        <h2>Local dashboard data</h2>
        <p className="path">
          {info?.dataDirectory ?? 'Loading storage location…'}
        </p>
        <p>
          Clearing removes the dashboard’s imported history and disables
          sources. Original Copilot history, exported JSON, and telemetry files
          are unchanged. Re-enabling a source can import its history again.
        </p>
        <label>
          Clear confirmation
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="CLEAR LOCAL DASHBOARD DATA"
          />
        </label>
        <button
          className="danger"
          disabled={confirmation !== 'CLEAR LOCAL DASHBOARD DATA' || busy}
          onClick={() =>
            void action(async () => {
              await apiRequest('/api/local-data/clear', {
                method: 'POST',
                body: JSON.stringify({ confirmation }),
              });
              setConfirmation('');
            }, 'Local history cleared. Sources are disabled. Original files are unchanged.')
          }
        >
          Clear local data
        </button>
      </section>
    </section>
  );
}
