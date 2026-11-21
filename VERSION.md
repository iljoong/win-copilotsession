# Application version history

The first version entry is current. Add a new entry above previous entries only
when an explicit next-version or specific-version request is approved. Ordinary
commits, pushes, builds, and releases never increment the version.

## 0.3.0

Date: 2026-11-21

- Show the stored Copilot CLI session title in the sidebar and keep observed
  state separate. Pick up renamed sessions without waiting for new events.
- Show the first model plus the number of other models, and replace Recorded
  agent time with Wall Time in the session list and sort controls.
- Add the session title, source session ID and cache-read percentage to Session
  Info. Remove Recorded agent time from the Usage overview.
- Animate the blue outline of in-progress tasks in the dependency graph, with
  a steady outline when reduced motion is enabled.

## 0.2.0

Date: 2026-11-17

- Add read-only Copilot CLI session TODO status with exact completed/all progress
  and live refresh while the selected TODO view is active.
- Organize session details into Conversation, Session Info and Todo status tabs.
- Group TODOs by dependency links, with status counts, creation-to-last-update
  spans, ordering controls and expandable dependency diagrams.
- Keep dependency cards focused on the graph; show each task's title, ID, source
  creation time and status, with a separate All tasks table.
- Preserve original session databases through bounded disposable snapshots and
  label unavailable dependency, timestamp and progress data without guessing.

## 0.1.0

Date: 2026-11-13

Initial portable Windows release: conversation-focused sessions, explicit source
consent, local usage analysis, and the WebView2 desktop app.
