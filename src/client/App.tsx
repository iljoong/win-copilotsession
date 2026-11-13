import { useState } from 'react';
import { SessionsPage } from './sessions.js';
import { SourcesPage } from './sources.js';
import { UsagePage } from './usage.js';
import './styles.css';

export function App() {
  const [view, setView] = useState(
    new URLSearchParams(window.location.search).get('view') ?? 'sessions',
  );
  const [connected, setConnected] = useState(false);
  const descriptions: Record<string, string> = {
    sessions: 'Trace the work. Find the prompt. Understand the usage.',
    usage:
      'Recorded usage across matching sessions. No currency estimates or guessed billing conversions.',
    sources:
      'Choose what this machine reads. Nothing is enabled automatically.',
  };
  return (
    <>
      <header className="app-header">
        <a className="wordmark" href="/">
          Copilot Sessions
        </a>
        <nav aria-label="Main navigation">
          {['sessions', 'usage', 'sources'].map((name) => (
            <button
              key={name}
              aria-current={view === name ? 'page' : undefined}
              onClick={() => {
                if (name !== view) setConnected(false);
                setView(name);
                const url = new URL(window.location.href);
                url.searchParams.set('view', name);
                window.history.replaceState({}, '', url);
              }}
            >
              {name === 'sessions'
                ? 'Sessions'
                : name === 'usage'
                  ? 'Usage'
                  : 'Sources'}
            </button>
          ))}
        </nav>
        <p className="tab-description">
          {descriptions[view] ?? descriptions.sessions}
        </p>
        {view === 'sessions' && (
          <span className={`connection ${connected ? 'connected' : ''}`}>
            {connected ? 'Live updates connected' : 'Live updates disconnected'}
          </span>
        )}
      </header>
      <main>
        {view === 'sources' ? (
          <SourcesPage />
        ) : view === 'usage' ? (
          <UsagePage />
        ) : (
          <SessionsPage onConnectionChange={setConnected} />
        )}
      </main>
    </>
  );
}
