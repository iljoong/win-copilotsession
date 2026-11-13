Copilot Session Dashboard - portable package
=============================================

This is a portable app. It does not install anything and does not touch
Windows Registry Run keys, scheduled tasks, or services. It needs the
Microsoft Edge WebView2 Runtime, which Windows 11 includes; this app never
installs it.

Before you start
------------------
Right-click the downloaded zip, choose Properties, tick Unblock, and select
OK, then extract it. This avoids a per-file "Open File - Security Warning"
prompt for the .cmd entry point below.

How to run it
--------------
Start one of these two entry points in the extracted
"CopilotSessionDashboard" folder:

  - CopilotSessionDashboard.exe for ordinary PCs. It is unsigned, so
    Microsoft Defender SmartScreen may show "Windows protected your PC";
    choose More info then Run anyway if you trust the download.

  - "CopilotSessionDashboard (Defender ASR).cmd" when a managed PC's
    Defender Attack Surface Reduction rules block the exe (event 1121). It
    launches the same app through the bundled, Microsoft-signed
    runtime\dotnet.exe instead of the app's own executable. A console
    window may flash briefly at start.

Closing the window quits the app completely. There is no system tray icon
and nothing keeps running in the background afterwards. Starting it again
while it is running brings the existing window forward.

Do not run this portable app and browser mode (npm start / npm run dev)
from the source repository at the same time. They share the same data
folder and simultaneous use is unsupported.

Where your data lives
-----------------------
Your session history and settings are stored under:
  %LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data

The app's own WebView2 profile and log file are stored under:
  %LOCALAPPDATA%\CopilotSessionDashboard\desktop

Nothing is written inside this folder (the one this file is in). The folder
you extracted the zip into is only ever read from. The log file never
contains startup tokens or prompts.

Uninstalling
-------------
There is no installer and nothing to uninstall. Delete this folder to
remove the app. Your dashboard data stays; remove it from inside the app
with Clear local data. Deleting
%LOCALAPPDATA%\CopilotSessionDashboard\desktop only removes logs and the
WebView2 profile, not your dashboard data.

What's inside this folder
---------------------------
  CopilotSessionDashboard.exe / .dll  - the app itself
  runtime\                           - the bundled, unmodified .NET runtime
  node\                              - the bundled, unmodified Node.js runtime
  app\                               - the unchanged web dashboard and server
  THIRD_PARTY_NOTICES.txt            - licenses for everything bundled above

This app only ever talks to 127.0.0.1 (itself). It does not phone home.
