import { createHash } from 'node:crypto';
import type {
  SessionTodo,
  SessionTodoGroups,
  TodoDependency,
  TodoGroupSummary,
} from '../../shared/contracts.js';
import { todoTime } from '../../shared/todo-time.js';
import { todoRows, withTodoSnapshot } from './todos.js';

type Options = {
  order: 'updated' | 'created';
  group: string | null;
  taskOffset: number;
};

function groupTimes(items: SessionTodo[]) {
  const created = items.map((item) => todoTime(item.created_at));
  const updated = items.map((item) => todoTime(item.updated_at));
  const times = [...created, ...updated];
  const known = times.filter((time) => time !== null);
  const sameClock = new Set(known.map((time) => time.clock)).size <= 1;
  const earliest = sameClock
    ? created.reduce(
        (best, time, index) =>
          time && (best < 0 || time.value < created[best]!.value)
            ? index
            : best,
        -1,
      )
    : -1;
  const latest = sameClock
    ? updated.reduce(
        (best, time, index) =>
          time && (best < 0 || time.value > updated[best]!.value)
            ? index
            : best,
        -1,
      )
    : -1;
  const complete =
    sameClock &&
    times.every((time) => time !== null) &&
    items.every((_, index) => updated[index]!.value >= created[index]!.value);
  return {
    createdAt: earliest < 0 ? null : items[earliest].created_at,
    updatedAt: latest < 0 ? null : items[latest].updated_at,
    spanMs:
      complete && earliest >= 0 && latest >= 0
        ? updated[latest]!.value - created[earliest]!.value
        : null,
  };
}

function hasCycle(ids: string[], edges: TodoDependency[]) {
  const degree = new Map(ids.map((id) => [id, 0]));
  const children = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    degree.set(edge.todo_id, degree.get(edge.todo_id)! + 1);
    children.get(edge.depends_on)!.push(edge.todo_id);
  }
  const queue = ids.filter((id) => degree.get(id) === 0);
  for (let index = 0; index < queue.length; index++) {
    for (const id of children.get(queue[index])!) {
      degree.set(id, degree.get(id)! - 1);
      if (degree.get(id) === 0) queue.push(id);
    }
  }
  return queue.length !== ids.length;
}

function groupLabel(items: SessionTodo[], edges: TodoDependency[]) {
  if (items.length > 1) {
    let prefix = items[0].id;
    for (const item of items) {
      let length = 0;
      while (length < prefix.length && prefix[length] === item.id[length])
        length++;
      prefix = prefix.slice(0, length);
    }
    const boundary = prefix.lastIndexOf('-');
    if (boundary > 0) return prefix.slice(0, boundary);
  }
  const dependent = new Set(edges.map((edge) => edge.todo_id));
  return (items.find((item) => !dependent.has(item.id)) ?? items[0]).title;
}

export async function readSessionTodoGroups(
  location: { root: string; sessionRef: string } | null,
  offset: number,
  limit: number,
  options: Options,
): Promise<SessionTodoGroups> {
  const unavailable: SessionTodoGroups = {
    availability: 'unavailable',
    message:
      'TODO groups unavailable. A readable enabled CLI session.db is required. All tasks may still be available.',
    dependenciesAvailable: false,
    items: [],
    total: 0,
    taskTotal: 0,
    completed: null,
    detail: null,
    offset,
    limit,
  };
  return (
    (await withTodoSnapshot(location, (db, table): SessionTodoGroups => {
      const items = todoRows(db, table, 10001, 0);
      if (items.length > 10000)
        return {
          ...unavailable,
          message:
            'Grouped view supports up to 10,000 tasks. Use All tasks; no truncated groups are shown.',
        };
      const byId = new Map(items.map((item) => [item.id, item]));
      if (byId.size !== items.length) return unavailable;
      const schema = db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name='todo_deps'",
        )
        .get();
      const columns = schema
        ? db.prepare('PRAGMA table_info(todo_deps)').all()
        : [];
      let dependenciesAvailable = ['todo_id', 'depends_on'].every((name) =>
        columns.some((column) => column.name === name),
      );
      const rows = dependenciesAvailable
        ? db
            .prepare('SELECT todo_id, depends_on FROM todo_deps LIMIT 50001')
            .all()
        : [];
      if (rows.length > 50000)
        return {
          ...unavailable,
          message:
            'Grouped view supports up to 50,000 dependency rows. Use All tasks; no truncated groups are shown.',
        };
      const parents = new Map(items.map((item) => [item.id, item.id]));
      const find = (id: string) => {
        let root = id;
        while (parents.get(root) !== root) root = parents.get(root)!;
        while (parents.get(id) !== id) {
          const next = parents.get(id)!;
          parents.set(id, root);
          id = next;
        }
        return root;
      };
      const edges: TodoDependency[] = [];
      const seen = new Set<string>();
      const missing = new Set<string>();
      for (const row of rows) {
        if (
          [row.todo_id, row.depends_on].some(
            (id) => typeof id !== 'string' && typeof id !== 'number',
          )
        ) {
          dependenciesAvailable = false;
          continue;
        }
        const edge = {
          todo_id: String(row.todo_id),
          depends_on: String(row.depends_on),
        };
        if (!byId.has(edge.todo_id) || !byId.has(edge.depends_on)) {
          if (byId.has(edge.todo_id)) missing.add(edge.todo_id);
          if (byId.has(edge.depends_on)) missing.add(edge.depends_on);
          continue;
        }
        const key = JSON.stringify([edge.todo_id, edge.depends_on]);
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(edge);
        const a = find(edge.todo_id),
          b = find(edge.depends_on);
        if (a !== b) parents.set(a, b);
      }
      const components = new Map<string, SessionTodo[]>();
      for (const item of items) {
        const root = find(item.id);
        if (!components.has(root)) components.set(root, []);
        components.get(root)!.push(item);
      }
      const componentEdges = new Map<string, TodoDependency[]>();
      for (const edge of edges) {
        const root = find(edge.todo_id);
        if (!componentEdges.has(root)) componentEdges.set(root, []);
        componentEdges.get(root)!.push(edge);
      }
      const groups = [...components].map(([root, members]) => {
        const links = componentEdges.get(root) ?? [];
        const statuses = new Map<string, number>();
        for (const member of members)
          statuses.set(member.status, (statuses.get(member.status) ?? 0) + 1);
        const times = groupTimes(members);
        const cycle = hasCycle(
          members.map((member) => member.id),
          links,
        );
        const warnings = [];
        if (members.some((member) => missing.has(member.id)))
          warnings.push(
            'Missing dependency endpoints; this group may be incomplete.',
          );
        if (cycle) warnings.push('Dependency cycle detected.');
        if (times.spanMs === null)
          warnings.push(
            'Time range unavailable: missing, invalid, incompatible or inverted source timestamps.',
          );
        let minimum = members[0].id;
        for (const member of members)
          if (member.id < minimum) minimum = member.id;
        const summary: TodoGroupSummary = {
          id: `g-${createHash('sha256').update(minimum).digest('hex').slice(0, 24)}`,
          label: groupLabel(members, links),
          total: members.length,
          completed: statuses.get('done') ?? 0,
          statuses: Object.fromEntries(statuses),
          ...times,
          warnings,
        };
        return { summary, members, links, cycle };
      });
      const compareTime = (
        a: SessionTodo['created_at'],
        b: SessionTodo['created_at'],
      ) => {
        const left = todoTime(a),
          right = todoTime(b);
        if (!left) return right ? 1 : 0;
        if (!right) return -1;
        // Each source clock retains its own ordering; cross-clock values have no comparable instant.
        if (left.clock !== right.clock)
          return left.clock < right.clock ? -1 : 1;
        return right.value - left.value;
      };
      groups.sort(
        (a, b) =>
          compareTime(
            options.order === 'updated'
              ? a.summary.updatedAt
              : a.summary.createdAt,
            options.order === 'updated'
              ? b.summary.updatedAt
              : b.summary.createdAt,
          ) ||
          compareTime(a.summary.createdAt, b.summary.createdAt) ||
          (a.summary.id < b.summary.id
            ? -1
            : a.summary.id > b.summary.id
              ? 1
              : 0),
      );
      const notices: string[] = [];
      if (!dependenciesAvailable)
        notices.push(
          'Dependency data unavailable or unsupported. Tasks shown separately may not be independent; grouping may be incomplete.',
        );
      const clocks = new Set(
        items
          .flatMap((item) => [
            todoTime(item.created_at)?.clock,
            todoTime(item.updated_at)?.clock,
          ])
          .filter((clock) => clock !== undefined),
      );
      if (clocks.size > 1)
        notices.push(
          'Timestamps use different clocks. Clock types are ordered separately, not compared as instants.',
        );
      const selected = groups.find(
        (group) => group.summary.id === options.group,
      );
      const graphMessage = !selected
        ? null
        : selected.cycle
          ? 'Dependency cycle detected; use All tasks instead of an acyclic diagram.'
          : selected.members.length > 80 || selected.links.length > 400
            ? 'Graph omitted above 80 tasks or 400 edges. Use All tasks for the paginated list.'
            : null;
      return {
        availability: 'available',
        message: notices.length ? notices.join(' ') : null,
        dependenciesAvailable,
        items: groups
          .slice(offset, offset + limit)
          .map((group) => group.summary),
        total: groups.length,
        taskTotal: items.length,
        completed: items.filter((item) => item.status === 'done').length,
        offset,
        limit,
        detail: selected
          ? {
              summary: selected.summary,
              total: selected.members.length,
              offset: options.taskOffset,
              limit: 50,
              items: selected.members.slice(
                options.taskOffset,
                options.taskOffset + 50,
              ),
              graph: graphMessage
                ? null
                : { nodes: selected.members, edges: selected.links },
              graphMessage,
            }
          : null,
      };
    })) ?? unavailable
  );
}
