import { useEffect, useState } from 'react';
import type {
  SessionTodoGroups,
  TodoGroupSummary,
} from '../shared/contracts.js';
import { todoSpanLabel } from '../shared/todo-time.js';
import { apiRequest } from './api.js';
import { TodoGroupVisuals } from './todo-group-visuals.js';

const groupPageSize = 20;

export function TodoGroupsPanel({
  sessionId,
  active,
}: {
  sessionId: string;
  active: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [order, setOrder] = useState<'updated' | 'created'>('updated');
  const [expanded, setExpanded] = useState<string | null | undefined>(
    undefined,
  );
  const [result, setResult] = useState<{
    offset: number;
    order: string;
    data: SessionTodoGroups | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(groupPageSize),
        groupOrder: order,
      });
      if (expanded) params.set('group', expanded);
      try {
        const data = await apiRequest<SessionTodoGroups>(
          `/api/sessions/${sessionId}/todo-groups?${params}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (data.availability === 'available') {
          if (offset > 0 && offset >= data.total) {
            setOffset(
              Math.max(
                0,
                Math.floor((data.total - 1) / groupPageSize) * groupPageSize,
              ),
            );
            setExpanded(null);
            return;
          }
          if (expanded === undefined)
            setExpanded(
              data.items.find((group) => group.completed < group.total)?.id ??
                null,
            );
          else if (expanded && !data.detail) {
            setExpanded(null);
          }
        }
        setResult({ offset, order, data, error: null });
      } catch {
        if (controller.signal.aborted) return;
        setResult({
          offset,
          order,
          data: null,
          error: 'Could not load TODO groups. Retrying automatically.',
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
  }, [sessionId, active, offset, order, expanded]);
  const current =
    result?.offset === offset && result.order === order ? result : null;
  const data = current?.data;
  const percent =
    data?.availability === 'available' &&
    data.taskTotal > 0 &&
    data.completed !== null
      ? Math.round((data.completed / data.taskTotal) * 1000) / 10
      : null;
  const detail =
    data?.detail && data.detail.summary.id === expanded ? data.detail : null;
  function changePage(next: number) {
    setOffset(next);
    setExpanded(null);
  }
  function toggleGroup(group: TodoGroupSummary, open: boolean) {
    setExpanded((current) =>
      open ? group.id : current === group.id ? null : current,
    );
  }
  return (
    <div className="todo-groups">
      {active && (
        <>
          {!current && <p role="status">Loading TODO groups…</p>}
          {current?.error && <p role="status">{current.error}</p>}
          {current &&
            (percent === null ? (
              <p className="muted">Progress unavailable</p>
            ) : (
              <div className="todo-progress">
                <div className="todo-progress-label">
                  <span>
                    {data!.completed} of {data!.taskTotal} tasks done
                  </span>
                  <strong>{percent}%</strong>
                </div>
                <progress
                  aria-label="TODO completion"
                  aria-valuetext={`${data!.completed} of ${data!.taskTotal} tasks done (${percent}%)`}
                  value={data!.completed!}
                  max={data!.taskTotal}
                />
                <p className="muted">
                  TODO completion, not session completion.
                </p>
              </div>
            ))}
          {data?.message && (
            <p className="todo-data-notice" role="status">
              {data.message}
            </p>
          )}
          {data?.availability === 'available' && (
            <>
              <div className="todo-group-toolbar">
                <p className="muted">
                  {data.total} groups · {data.taskTotal} tasks
                </p>
                <label>
                  Group order
                  <select
                    value={order}
                    onChange={(event) => {
                      setOrder(event.target.value as 'updated' | 'created');
                      changePage(0);
                    }}
                  >
                    <option value="updated">Last modified, newest first</option>
                    <option value="created">Created, newest first</option>
                  </select>
                </label>
              </div>
              <p className="muted todo-time-caveat">
                Creation to last update is a recorded span, not execution
                duration. Timestamps retain the source clock.
              </p>
              {data.taskTotal === 0 && <p>No TODO items in this session.</p>}
              <div className="todo-group-list">
                {data.items.map((group) => {
                  const percent =
                    Math.round((group.completed / group.total) * 1000) / 10;
                  return (
                    <details
                      key={group.id}
                      className="todo-group"
                      aria-label={`TODO group ${group.label}`}
                      open={expanded === group.id}
                      onToggle={(event) =>
                        toggleGroup(group, event.currentTarget.open)
                      }
                    >
                      <summary>
                        <span className="todo-group-heading">
                          <strong>{group.label}</strong>
                          <span>
                            {group.completed} / {group.total} done
                          </span>
                        </span>
                        <span className="todo-progress">
                          <span className="todo-progress-label">
                            <span>
                              {group.total === 1
                                ? 'Single task'
                                : 'Dependency group'}
                            </span>
                            <strong>{percent}%</strong>
                          </span>
                          <progress
                            aria-label={`${group.label} completion`}
                            value={group.completed}
                            max={group.total}
                            aria-valuetext={`${group.completed} of ${group.total} tasks done (${percent}%)`}
                          />
                        </span>
                        <span className="todo-status-counts">
                          {Object.entries(group.statuses)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([status, count]) => (
                              <span key={status}>
                                {status}: {count}
                              </span>
                            ))}
                        </span>
                        <span className="todo-group-range">
                          <span>
                            Created: {group.createdAt ?? 'Unavailable'}
                          </span>
                          <span>
                            Last updated: {group.updatedAt ?? 'Unavailable'}
                          </span>
                          <span>
                            Creation to last update:{' '}
                            <strong>{todoSpanLabel(group.spanMs)}</strong>
                          </span>
                        </span>
                        {group.warnings.map((warning) => (
                          <span className="todo-group-warning" key={warning}>
                            {warning}
                          </span>
                        ))}
                      </summary>
                      {expanded === group.id && (
                        <div className="todo-group-detail">
                          {!detail || detail.summary.id !== group.id ? (
                            <p role="status">Loading group details…</p>
                          ) : (
                            <TodoGroupVisuals detail={detail} />
                          )}
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
              {data.total > groupPageSize && (
                <nav className="pagination" aria-label="TODO group pagination">
                  <button
                    disabled={offset === 0}
                    onClick={() => changePage(offset - groupPageSize)}
                  >
                    Previous groups
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + groupPageSize, data.total)}{' '}
                    of {data.total}
                  </span>
                  <button
                    disabled={offset + groupPageSize >= data.total}
                    onClick={() => changePage(offset + groupPageSize)}
                  >
                    Next groups
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
