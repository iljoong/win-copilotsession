using System.Collections;
using System.ComponentModel;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Shell;

/// <summary>
/// The dashboard window: starts the Node sidecar, hosts it in a locked-down WebView2, shows a
/// startup error screen (with retry) when anything fails, and stops the sidecar on close.
/// The title is fixed and never reflects the page, its URL, or its token.
/// </summary>
public partial class MainWindow : Window
{
    private const string WebView2DownloadUrl = "https://developer.microsoft.com/microsoft-edge/webview2/";
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan StopGrace = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan StartupDrainLimit = TimeSpan.FromSeconds(10);

#if TESTING
    private const bool IsTesting = true;
    private readonly TestingOptions _testing;
#else
    private const bool IsTesting = false;
#endif

    private SafeLog? _log;
    private string? _logDir;
    private BackendSession? _session;
    private WebView2? _webView;
    private CancellationTokenSource? _startCts;
    private Task _startTask = Task.CompletedTask;
    private bool _closing;
    private bool _readyToClose;

#if TESTING
    public MainWindow(TestingOptions testing)
    {
        _testing = testing;
#else
    public MainWindow()
    {
#endif
        InitializeComponent();
        Title = $"Copilot Session Dashboard v{typeof(MainWindow).Assembly.GetName().Version!.ToString(3)}";
        Loaded += (_, _) => BeginStart();
    }

    public void BringToFront()
    {
        if (_closing)
        {
            return;
        }

        if (WindowState == WindowState.Minimized)
        {
            WindowState = WindowState.Normal;
        }

        Show();
        Activate();
        Topmost = true;
        Topmost = false;
        Focus();
    }

    /// <summary>
    /// Windows session end: hide and stop the sidecar synchronously, bounded by the grace period.
    /// </summary>
    public void StopForSessionEnd()
    {
        if (_readyToClose)
        {
            return;
        }

        _closing = true;
        _startCts?.Cancel();
        Hide();
        _log?.Write("session ending");

        var session = _session;
        _session = null;
        try
        {
            session?.StopAsync(StopGrace).Wait(StopGrace);
        }
        catch (Exception ex)
        {
            _log?.Write($"session-end stop failed: {ex.GetType().Name}");
        }

        _readyToClose = true;
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_readyToClose)
        {
            base.OnClosing(e);
            return;
        }

        e.Cancel = true;
        if (_closing)
        {
            return;
        }

        _closing = true;
        Hide();
        _ = ShutdownAsync();
    }

    private async Task ShutdownAsync()
    {
        _log?.Write("shell closing");
        _startCts?.Cancel();

        try
        {
            await Task.WhenAny(_startTask, Task.Delay(StartupDrainLimit));
            await TearDownAsync();
        }
        catch (Exception ex)
        {
            _log?.Write($"shutdown failed: {ex.GetType().Name}");
        }

        _log?.Write("shell exited");
        _readyToClose = true;
        Application.Current.Shutdown();
    }

    private void OnRetryClick(object sender, RoutedEventArgs e) => BeginStart();

    private void BeginStart()
    {
        if (_closing || !_startTask.IsCompleted)
        {
            return;
        }

        _startTask = StartAsync();
    }

    private async Task StartAsync()
    {
        using var cts = new CancellationTokenSource();
        _startCts = cts;
        ShowStatus();
        BackendSession? startedSession = null;

        try
        {
            await TearDownAsync();

            var paths = AppPaths.Resolve(AppContext.BaseDirectory, Environment.GetEnvironmentVariable("LOCALAPPDATA"))
                ?? throw new StartupFailure(
                    StartupFailureReason.LocalAppDataMissing,
                    "LOCALAPPDATA is not set to an absolute path.");

            _logDir = paths.LogDir;
            _log ??= new SafeLog(paths.LogDir);
            _log.Write("shell starting");

            EnsureWebView2Runtime(_log);

            var session = await BackendSupervisor.StartAsync(CreateLaunch(paths), ReadyTimeout, _log, cts.Token);
            startedSession = session;
            _session = session;
            _ = WatchBackendAsync(session);
            if (cts.IsCancellationRequested)
            {
                return;
            }

            var environment = await CreateEnvironmentAsync(paths.WebViewDir);
            if (cts.IsCancellationRequested || _session != session)
            {
                return;
            }

            var webView = new WebView2();
            _webView = webView;
            WebViewHost.Children.Add(webView);
            ShowWebView();

            var controllerOptions = environment.CreateCoreWebView2ControllerOptions();
            controllerOptions.IsInPrivateModeEnabled = true;
            await webView.EnsureCoreWebView2Async(environment, controllerOptions);
            if (cts.IsCancellationRequested || _session != session || _webView != webView)
            {
                return;
            }

            var port = session.Ready.Port;
            DashboardWebView.ApplyPolicy(
                webView.CoreWebView2,
                port,
                IsTesting,
                detail => OnViewFailed(webView, detail));

            webView.CoreWebView2.Navigate($"http://127.0.0.1:{port}/?token={session.Ready.Token}");
            _log.Write("window ready");
        }
        catch (StartupFailure failure)
        {
            _log?.Write($"startup failed reason={failure.Reason}");
            await ShowFailureAsync(Describe(failure.Reason), failure.Detail);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
        }
        catch (Exception) when (startedSession is not null && _session != startedSession)
        {
            // The backend watcher already tore this attempt down and showed why.
        }
        catch (Exception ex)
        {
            var detail = LogRedactor.Redact($"{ex.GetType().Name}: {ex.Message}");
            _log?.Write($"startup failed: {detail}");
            await ShowFailureAsync("Copilot Session Dashboard hit an unexpected error while starting.", detail);
        }
        finally
        {
            if (_startCts == cts)
            {
                _startCts = null;
            }
        }
    }

    private BackendLaunch CreateLaunch(AppPaths paths)
    {
        var parentEnv = Environment.GetEnvironmentVariables()
            .Cast<DictionaryEntry>()
            .ToDictionary(entry => (string)entry.Key, entry => (string?)entry.Value, StringComparer.OrdinalIgnoreCase);

#if TESTING
        if (_testing.DataDir is not null)
        {
            return BackendLaunch.ForApp(paths, parentEnv, _testing.DataDir);
        }
#endif

        return BackendLaunch.ForApp(paths, parentEnv);
    }

    private Task<CoreWebView2Environment> CreateEnvironmentAsync(string webViewDir)
    {
#if TESTING
        return DashboardWebView.CreateEnvironmentAsync(webViewDir, _testing.RemoteDebuggingPort);
#else
        return DashboardWebView.CreateEnvironmentAsync(webViewDir);
#endif
    }

    private static void EnsureWebView2Runtime(SafeLog log)
    {
        string? version;
        try
        {
            version = CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            version = null;
        }

        if (string.IsNullOrEmpty(version))
        {
            throw new StartupFailure(
                StartupFailureReason.WebView2Missing,
                $"Install the Microsoft Edge WebView2 Runtime from {WebView2DownloadUrl} and retry.");
        }

        log.Write($"webview2 runtime {version}");
    }

    private async Task WatchBackendAsync(BackendSession session)
    {
        int exitCode;
        try
        {
            exitCode = await session.Exited;
        }
        catch (Exception)
        {
            exitCode = -1;
        }

        if (_closing || _session != session)
        {
            return;
        }

        _log?.Write($"backend exited code={exitCode}");
        await ShowFailureAsync("The dashboard backend stopped.", $"Exit code: {exitCode}");
    }

    private void OnViewFailed(WebView2 webView, string detail)
    {
        if (_closing || _webView != webView)
        {
            return;
        }

        _log?.Write(detail);
        _ = ShowFailureAsync("The dashboard view stopped working.", detail);
    }

    private async Task ShowFailureAsync(string reason, string detail)
    {
        WebViewHost.Visibility = Visibility.Collapsed;
        StatusPanel.Visibility = Visibility.Collapsed;

        try
        {
            await TearDownAsync();
        }
        catch (Exception ex)
        {
            // Log only the exception type: the message could echo backend output that
            // carries the startup token or URL. The error panel must still show below so
            // the window never goes blank with no Retry.
            _log?.Write($"teardown during failure threw {ex.GetType().Name}");
        }

        if (_closing)
        {
            return;
        }

        ErrorReason.Text = reason;
        ErrorDetail.Text = detail;
        ErrorLogDir.Text = _logDir ?? "(unavailable)";
        ErrorPanel.Visibility = Visibility.Visible;
    }

    private async Task TearDownAsync()
    {
        var session = _session;
        var webView = _webView;
        _session = null;
        _webView = null;
        WebViewHost.Visibility = Visibility.Collapsed;

        if (session is not null)
        {
            await session.StopAsync(StopGrace);
            await session.DisposeAsync();
        }

        if (webView is not null)
        {
            WebViewHost.Children.Remove(webView);
            webView.Dispose();
        }
    }

    private void ShowStatus()
    {
        ErrorPanel.Visibility = Visibility.Collapsed;
        WebViewHost.Visibility = Visibility.Collapsed;
        StatusPanel.Visibility = Visibility.Visible;
    }

    private void ShowWebView()
    {
        ErrorPanel.Visibility = Visibility.Collapsed;
        StatusPanel.Visibility = Visibility.Collapsed;
        WebViewHost.Visibility = Visibility.Visible;
    }

    private static string Describe(StartupFailureReason reason) => reason switch
    {
        StartupFailureReason.NodeMissing =>
            "The bundled Node runtime (node\\node.exe) is missing. Extract the whole zip again.",
        StartupFailureReason.LocalAppDataMissing =>
            "The LOCALAPPDATA folder is not available, so the app has nowhere to keep its data.",
        StartupFailureReason.WebView2Missing =>
            "The Microsoft Edge WebView2 Runtime is not installed.",
        StartupFailureReason.ExitedBeforeReady =>
            "The dashboard backend stopped before it was ready.",
        StartupFailureReason.ReadyTimeout =>
            "The dashboard backend did not become ready within 30 seconds.",
        StartupFailureReason.InvalidReadyLine =>
            "The dashboard backend sent an unexpected startup response.",
        _ => "Copilot Session Dashboard could not start.",
    };
}
