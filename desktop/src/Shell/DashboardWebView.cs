using Microsoft.Web.WebView2.Core;

namespace Shell;

/// <summary>
/// Creates the shell's WebView2 environment and applies the locked-down browser policy: no
/// DevTools (outside Testing builds), host objects, web messages, autofill, password saving,
/// status bar, or browser accelerator keys; navigation only to the sidecar's loopback port;
/// no new windows, downloads, or permissions.
/// </summary>
public static class DashboardWebView
{
    // WebView2 reads these from the process environment and lets them override the options
    // the shell passes (extra browser switches, runtime folder, profile folder), so a user
    // environment must not be able to loosen the policy.
    private static readonly string[] OverrideVariables =
    [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        "WEBVIEW2_USER_DATA_FOLDER",
        "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
        "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER",
    ];

    public static Task<CoreWebView2Environment> CreateEnvironmentAsync(string webViewDir)
    {
        ArgumentException.ThrowIfNullOrEmpty(webViewDir);

        ClearEnvironmentOverrides();
        return CoreWebView2Environment.CreateAsync(null, webViewDir, new CoreWebView2EnvironmentOptions());
    }

#if TESTING
    /// <summary>
    /// Testing-only: exposes the Chrome DevTools Protocol on <c>127.0.0.1:<paramref name="remoteDebuggingPort"/></c>
    /// so end-to-end tests can drive the window.
    /// </summary>
    public static Task<CoreWebView2Environment> CreateEnvironmentAsync(string webViewDir, int? remoteDebuggingPort)
    {
        ArgumentException.ThrowIfNullOrEmpty(webViewDir);

        if (remoteDebuggingPort is null)
        {
            return CreateEnvironmentAsync(webViewDir);
        }

        ClearEnvironmentOverrides();
        var options = new CoreWebView2EnvironmentOptions
        {
            AdditionalBrowserArguments =
                $"--remote-debugging-port={remoteDebuggingPort.Value} --remote-debugging-address=127.0.0.1",
        };
        return CoreWebView2Environment.CreateAsync(null, webViewDir, options);
    }
#endif

    /// <summary>
    /// Applies the settings and event handlers that confine <paramref name="core"/> to the
    /// sidecar at <c>http://127.0.0.1:<paramref name="port"/></c>. A renderer failure reloads
    /// once; a repeated failure, or the browser process exiting, calls
    /// <paramref name="onFatalFailure"/> with a short, URL-free description.
    /// </summary>
    public static void ApplyPolicy(CoreWebView2 core, int port, bool isTesting, Action<string>? onFatalFailure = null)
    {
        ArgumentNullException.ThrowIfNull(core);

        var settings = core.Settings;
        settings.AreDevToolsEnabled = isTesting;
        settings.AreHostObjectsAllowed = false;
        settings.IsWebMessageEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;

        core.NavigationStarting += (_, e) => e.Cancel = !IsAllowed(e.Uri, port);
        core.FrameNavigationStarting += (_, e) => e.Cancel = !IsAllowed(e.Uri, port);

        core.NewWindowRequested += (_, e) => e.Handled = true;

        core.DownloadStarting += (_, e) =>
        {
            e.Cancel = true;
            e.Handled = true;
        };

        // Clipboard writes from a user gesture and <input type="file"> do not raise
        // PermissionRequested, so every request that does arrive is denied.
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;

        var reloaded = false;
        core.ProcessFailed += (_, e) =>
        {
            switch (e.ProcessFailedKind)
            {
                case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                    onFatalFailure?.Invoke($"WebView2 browser process exited ({e.Reason}).");
                    break;

                case CoreWebView2ProcessFailedKind.RenderProcessExited:
                case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                    if (reloaded)
                    {
                        onFatalFailure?.Invoke($"WebView2 renderer failed again ({e.ProcessFailedKind}, {e.Reason}).");
                    }
                    else
                    {
                        reloaded = true;
                        core.Reload();
                    }

                    break;
            }
        };
    }

    private static bool IsAllowed(string? uri, int port) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var parsed) && NavigationPolicy.IsAllowed(parsed, port);

    private static void ClearEnvironmentOverrides()
    {
        foreach (var name in OverrideVariables)
        {
            Environment.SetEnvironmentVariable(name, null);
        }
    }
}
