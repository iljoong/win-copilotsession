namespace Shell;

/// <summary>
/// Decides which navigation targets the shell's WebView2 control is allowed to load:
/// only plain HTTP to the loopback address on the sidecar's exact port.
/// </summary>
public static class NavigationPolicy
{
    private const string LoopbackHost = "127.0.0.1";

    /// <summary>
    /// Returns true only for <c>http://127.0.0.1:&lt;port&gt;/...</c> URIs, rejecting any other
    /// scheme, host, port, or embedded userinfo (such as <c>http://x@127.0.0.1:5000/</c>), and
    /// look-alike hosts such as subdomains of 127.0.0.1.
    /// </summary>
    public static bool IsAllowed(Uri uri, int port)
    {
        ArgumentNullException.ThrowIfNull(uri);

        return uri.IsAbsoluteUri
            && string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.Ordinal)
            && uri.UserInfo.Length == 0
            && string.Equals(uri.Host, LoopbackHost, StringComparison.Ordinal)
            && uri.Port == port;
    }
}
