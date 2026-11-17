# Session detail tabs implementation

Design: [Session detail tabs](../specs/2026-11-17-session-detail-tabs-design.md)

1. Update/add focused failing tests in `tests\routes.test.ts` and
   `tests\sessions.test.tsx` for global done counts, descending TODO pages,
   progress edge cases and the new tab layout/keyboard/polling behavior.
2. Extend `SessionTodos` in `src\shared\contracts.ts`, aggregate/count in
   `src\server\sources\todos.ts`, and keep source-change responses in
   `src\server\routes.ts` consistent. Depends on step 1. Run targeted API tests.
3. Replace detail expanders with accessible tabs in `src\client\sessions.tsx`,
   retain mounted panel state, render TODO completion in `session-todos.tsx`,
   and add focused styles using existing tokens. Update source consent help.
   Depends on step 1 and the response contract from step 2.
4. Adapt browser and WebView2 regressions to tabs; retain original prompt,
   accounting, sidebar, activity and responsive acceptance. Update current
   manual/README/handoff and mark earlier TODO design as superseded.
   Depends on steps 2 and 3.
5. Run `npm test`, `npm run typecheck`, `npm run lint`,
   `npm run format:check`, `npm run test:e2e`, desktop tests/C# formatting,
   Release packaging, `desktop:e2e` and Defender smoke. Check changed docs'
   local links and the resulting ZIP. Do not bump version, commit or publish.
   Depends on step 4.
