# Copilot Session Dashboard

Local-only session browser for Copilot CLI and VS Code.

## Compatibility evidence

- CLI event shapes were inspected read-only from Copilot CLI 1.0.109. No original conversation text is included in fixtures.
- VS Code 1.146.0 export shapes were checked against first-party source at commit `69047191fc427f2f92828279aae1d90d8eeda7ab`, `src/vs/workbench/contrib/chat/common/model/chatModel.ts`. Fixture contents are synthetic. A real user-selected export from this installation has not yet been validated.
- VS Code telemetry file spans follow the first-party `microsoft/vscode-copilot-chat` file exporter (`src/platform/otel/node/fileExporters.ts`) and official monitoring documentation. Fixtures are synthetic, not a live capture.
- Exported completed spans do not guarantee visibility into a tool currently running. Live exporter timing remains unmeasured.
- CLI billing fields such as `cost` and `totalNanoAiu` are not treated as AIC without a verified mapping. VS Code snapshot `copilotCredits` can be displayed as partial per-request reported credits, but unidentified snapshots are excluded from combined totals.

Source documentation:

- https://code.visualstudio.com/docs/agents/run/sessions/session-history
- https://code.visualstudio.com/docs/agents/guides/monitoring-agents
- https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/workbench/contrib/chat/common/model/chatModel.ts
- https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/otel/node/fileExporters.ts
