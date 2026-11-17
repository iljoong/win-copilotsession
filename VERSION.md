# Application version history

The first version entry is current. Add a new entry above previous entries only
when an explicit next-version or specific-version request is approved. Ordinary
commits, pushes, builds, and releases never increment the version.

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
