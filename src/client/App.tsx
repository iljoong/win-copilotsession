import { useState } from 'react';
import { SessionsPage } from './sessions.js';
import { SourcesPage } from './sources.js';
import './styles.css';

export function App() {
  const [view, setView] = useState(
    new URLSearchParams(window.location.search).get('view') ?? 'sessions',
  );
  return (
    <>
      <header className="app-header">
        <a className="wordmark" href="/">
          Copilot Sessions
        </a>
        <nav aria-label="Main navigation">
          {['sessions', 'sources'].map((name) => (
            <button
              key={name}
              aria-current={view === name ? 'page' : undefined}
              onClick={() => {
                setView(name);
                const url = new URL(window.location.href);
                url.searchParams.set('view', name);
                window.history.replaceState({}, '', url);
              }}
            >
              {name === 'sessions' ? 'Sessions' : 'Sources'}
            </button>
          ))}
        </nav>
        <span className="local-label">On this machine</span>
      </header>
      <main>{view === 'sources' ? <SourcesPage /> : <SessionsPage />}</main>
    </>
  );
}
