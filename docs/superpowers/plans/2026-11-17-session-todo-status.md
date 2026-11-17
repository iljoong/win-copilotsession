# Session TODO status implementation

Design: [Session TODO status](../specs/2026-11-17-session-todo-status-design.md)

1. Add failing authenticated API regressions in `tests/routes.test.ts` for
   selected-source identity, four-field pagination, live WAL updates, unchanged
   sources, unavailable/empty distinctions, and source boundaries.
2. Add the shared TODO response contract, stored CLI-reference lookup, bounded
   source snapshot reader, and authenticated `/api/sessions/:id/todos` route.
   Depends on step 1. Run targeted API tests.
3. Add failing UI/browser regressions, then implement the default-closed
   expander, polling and pagination in `src/client/session-todos.tsx`,
   `sessions.tsx`, and `styles.css`. Depends on step 2. Verify keyboard toggling,
   source-field rendering, updates, switching, and narrow containment.
4. Update manual/handoff for TODO behavior and temporary-data boundaries.
   Depends on steps 2 and 3. Run `npm test`, `npm run typecheck`, `npm run lint`,
   `npm run format:check`, and `npm run test:e2e`; check changed documentation
   links. Preserve unrelated CRLF files if the known checkout issue appears.
