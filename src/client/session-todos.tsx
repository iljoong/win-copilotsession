import { useEffect, useState } from 'react';
import type { SessionTodos } from '../shared/contracts.js';
import { apiRequest } from './api.js';
import { TodoGroupsPanel } from './todo-groups.js';

const pageSize = 50;

export function SessionTodosPanel({
  sessionId,
  active,
}: {
  sessionId: string;
  active: boolean;
}) {
  const [view, setView] = useState<'groups' | 'tasks'>('groups');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{
    offset: number;
    data: SessionTodos | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!active || view !== 'tasks') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await apiRequest<SessionTodos>(
          `/api/sessions/${sessionId}/todos?offset=${offset}&limit=${pageSize}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (
          data.availability === 'available' &&
          offset > 0 &&
          offset >= data.total
        ) {
          setOffset(
            Math.max(0, Math.floor((data.total - 1) / pageSize) * pageSize),
          );
          return;
        }
        setResult({ offset, data, error: null });
      } catch {
        if (controller.signal.aborted) return;
        setResult({
          offset,
          data: null,
          error: 'Could not load TODO status. Retrying automatically.',
        });
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void refresh(), 1000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId, active, offset, view]);
  const current = result?.offset === offset ? result : null;
  const data = current?.data;
  const percentage =
    data?.availability === 'available' &&
    data.total > 0 &&
    data.completed !== null
      ? Math.round((data.completed / data.total) * 1000) / 10
      : null;
  return (
    <div className="session-todos">
      {active && (
        <div className="todo-view-controls" role="group" aria-label="TODO view">
          <button
            aria-pressed={view === 'groups'}
            onClick={() => setView('groups')}
          >
            Groups
          </button>
          <button
            aria-pressed={view === 'tasks'}
            onClick={() => setView('tasks')}
          >
            All tasks
          </button>
        </div>
      )}
      <div hidden={view !== 'groups'}>
        <TodoGroupsPanel
          sessionId={sessionId}
          active={active && view === 'groups'}
        />
      </div>
      {active && view === 'tasks' && (
        <>
          {!current && <p role="status">Loading TODO status…</p>}
          {current?.error && <p role="status">{current.error}</p>}
          {current &&
            (percentage === null ? (
              <p className="muted">Progress unavailable</p>
            ) : (
              <div className="todo-progress">
                <div className="todo-progress-label">
                  <span>
                    {data!.completed} of {data!.total} tasks done
                  </span>
                  <strong>{percentage}%</strong>
                </div>
                <progress
                  aria-label="TODO completion"
                  aria-valuetext={`${data!.completed} of ${data!.total} tasks done (${percentage}%)`}
                  value={data!.completed!}
                  max={data!.total}
                />
                <p className="muted">
                  TODO completion, not session completion.
                </p>
              </div>
            ))}
          {data?.availability === 'unavailable' && (
            <p className="muted" role="status">
              {data.message}
            </p>
          )}
          {data?.availability === 'available' && (
            <>
              <p className="muted">
                {data.total} tasks. Source status and timestamps; refreshed
                while this tab is active.
              </p>
              {data.total === 0 ? (
                <p>No TODO items in this session.</p>
              ) : (
                <div
                  className="todo-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="TODO table"
                >
                  <table aria-label="Session TODOs">
                    <thead>
                      <tr>
                        <th scope="col">id</th>
                        <th scope="col">created_at</th>
                        <th scope="col">title</th>
                        <th scope="col">status</th>
                        <th scope="col">updated_at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((todo, index) => (
                        <tr key={`${todo.id}:${index}`}>
                          <td>{todo.id}</td>
                          <td>{todo.created_at ?? 'Unavailable'}</td>
                          <td>{todo.title}</td>
                          <td>{todo.status}</td>
                          <td>{todo.updated_at ?? 'Unavailable'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.total > pageSize && (
                <nav className="pagination" aria-label="TODO pagination">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(offset - pageSize)}
                  >
                    Previous TODOs
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + pageSize, data.total)} of{' '}
                    {data.total}
                  </span>
                  <button
                    disabled={offset + pageSize >= data.total}
                    onClick={() => setOffset(offset + pageSize)}
                  >
                    Next TODOs
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
