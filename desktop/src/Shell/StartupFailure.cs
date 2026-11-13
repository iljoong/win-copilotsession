namespace Shell;

/// <summary>
/// The distinct ways the shell can fail to bring the Node sidecar up, surfaced to the
/// startup error screen without ever including a token, cookie, URL query string, or prompt.
/// </summary>
public enum StartupFailureReason
{
    NodeMissing,
    LocalAppDataMissing,
    WebView2Missing,
    ExitedBeforeReady,
    ReadyTimeout,
    InvalidReadyLine,
}

/// <summary>
/// Raised when the shell cannot bring the backend up. <see cref="Detail"/> (the exception
/// message) is always safe to show or log as-is: it has already been passed through
/// <see cref="LogRedactor.Redact"/> and, where it carries sidecar stderr, is limited to the
/// last 20 lines.
/// </summary>
public sealed class StartupFailure(StartupFailureReason reason, string detail) : Exception(detail)
{
    public StartupFailureReason Reason { get; } = reason;

    public string Detail => Message;
}
