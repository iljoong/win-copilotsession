using System.IO;

namespace Shell;

/// <summary>
/// The resolved set of filesystem paths the shell needs at startup: where the bundled
/// Node runtime and server entry point live under the unzipped app directory, and
/// where the shell's own writable state (WebView2 profile, logs) lives under
/// <c>%LOCALAPPDATA%</c>. The unzipped app directory itself is never written to.
/// </summary>
public sealed record AppPaths(
    string AppDir,
    string NodeExe,
    string ServerMain,
    string AppWorkDir,
    string StateDir,
    string WebViewDir,
    string LogDir)
{
    /// <summary>
    /// Resolves the shell's paths from the app's own directory and the user's
    /// <c>%LOCALAPPDATA%</c> value. Returns <c>null</c> when <paramref name="localAppData"/>
    /// is missing, empty, or not a fully qualified (drive-and-root) absolute path, such as a
    /// drive-relative path (<c>C:foo</c>) or a rooted-but-driveless path (<c>\foo</c>).
    /// </summary>
    public static AppPaths? Resolve(string appDir, string? localAppData)
    {
        ArgumentNullException.ThrowIfNull(appDir);

        if (string.IsNullOrEmpty(localAppData) || !Path.IsPathFullyQualified(localAppData))
        {
            return null;
        }

        var stateDir = Path.Combine(localAppData, "CopilotSessionDashboard", "desktop");
        var appWorkDir = Path.Combine(appDir, "app");

        return new AppPaths(
            AppDir: appDir,
            NodeExe: Path.Combine(appDir, "node", "node.exe"),
            ServerMain: Path.Combine(appWorkDir, "dist", "server", "main.js"),
            AppWorkDir: appWorkDir,
            StateDir: stateDir,
            WebViewDir: Path.Combine(stateDir, "WebView2"),
            LogDir: Path.Combine(stateDir, "logs"));
    }
}
