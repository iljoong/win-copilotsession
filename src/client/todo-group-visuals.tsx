import { useId } from 'react';
import type { TodoGroupDetail } from '../shared/contracts.js';

function DependencyGraph({ detail }: { detail: TodoGroupDetail }) {
  const marker = `todo-arrow-${useId().replace(/:/g, '')}`;
  if (!detail.graph) return <p className="muted">{detail.graphMessage}</p>;
  const { nodes, edges } = detail.graph;
  const levels = new Map(nodes.map((node) => [node.id, 0]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.todo_id, incoming.get(edge.todo_id)! + 1);
    children.get(edge.depends_on)!.push(edge.todo_id);
  }
  const queue = nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id);
  for (let index = 0; index < queue.length; index++)
    for (const child of children.get(queue[index])!) {
      levels.set(
        child,
        Math.max(levels.get(child)!, levels.get(queue[index])! + 1),
      );
      incoming.set(child, incoming.get(child)! - 1);
      if (incoming.get(child) === 0) queue.push(child);
    }
  const rows = new Map<number, number>();
  const positions = new Map(
    nodes.map((node) => {
      const level = levels.get(node.id)!;
      const row = rows.get(level) ?? 0;
      rows.set(level, row + 1);
      return [node.id, { x: 16 + level * 292, y: 16 + row * 136 }];
    }),
  );
  const width = (Math.max(...levels.values()) + 1) * 292;
  const height = Math.max(...rows.values()) * 136 + 16;
  return (
    <div
      className="todo-diagram-scroll"
      role="region"
      tabIndex={0}
      aria-label="Dependency diagram scroll area"
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Dependency graph for ${detail.summary.label}`}
      >
        <title>
          Prerequisite to dependent task. Layout is not execution time.
        </title>
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = positions.get(edge.depends_on)!;
          const to = positions.get(edge.todo_id)!;
          return (
            <path
              key={JSON.stringify([edge.depends_on, edge.todo_id])}
              className="todo-graph-edge"
              d={`M ${from.x + 240} ${from.y + 55} C ${from.x + 264} ${from.y + 55}, ${to.x - 24} ${to.y + 55}, ${to.x} ${to.y + 55}`}
              markerEnd={`url(#${marker})`}
            />
          );
        })}
        {nodes.map((node) => {
          const point = positions.get(node.id)!;
          return (
            <g key={node.id} transform={`translate(${point.x}, ${point.y})`}>
              <title>
                {node.title}
                {'\n'}
                {node.id}
                {'\n'}
                {node.created_at ?? 'Unavailable'}
                {'\n'}
                {node.status}
              </title>
              <rect
                className={`todo-graph-node ${node.status === 'done' ? 'todo-node-done' : ''}`}
                width="240"
                height="110"
                rx="5"
              />
              <foreignObject x="12" y="8" width="216" height="42">
                <p className="todo-graph-title">{node.title}</p>
              </foreignObject>
              <foreignObject x="12" y="56" width="216" height="42">
                <div className="todo-graph-meta">{node.id}</div>
                <div className="todo-graph-created">
                  {node.created_at ?? 'Unavailable'}
                </div>
                <div className="todo-graph-status">{node.status}</div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function TodoGroupVisuals({ detail }: { detail: TodoGroupDetail }) {
  return (
    <>
      <h4>Dependencies</h4>
      <p className="muted">
        Prerequisite → dependent. Layout does not indicate execution time or
        actual parallelism.
      </p>
      <DependencyGraph detail={detail} />
    </>
  );
}
