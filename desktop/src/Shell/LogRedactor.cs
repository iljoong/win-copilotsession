using System.Text.RegularExpressions;

namespace Shell;

/// <summary>
/// Strips secrets (bearer tokens, raw 64-character hex strings, and URL query strings)
/// out of text before it reaches logs, so sensitive values never reach disk.
/// </summary>
public static partial class LogRedactor
{
    /// <summary>
    /// Returns <paramref name="text"/> with long hex strings, <c>token=&lt;value&gt;</c>
    /// pairs, and HTTP(S) URL query strings replaced by <c>[redacted]</c> placeholders.
    /// Text containing none of those patterns is returned unchanged.
    /// </summary>
    public static string Redact(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        var redacted = UrlQueryPattern().Replace(text, "$1?[redacted]");
        redacted = TokenAssignmentPattern().Replace(redacted, "token=[redacted]");
        redacted = LongHexPattern().Replace(redacted, "[redacted]");
        return redacted;
    }

    [GeneratedRegex(@"(https?://[^\s?]+)\?[^\s]*", RegexOptions.IgnoreCase)]
    private static partial Regex UrlQueryPattern();

    [GeneratedRegex(@"\btoken=\S+", RegexOptions.IgnoreCase)]
    private static partial Regex TokenAssignmentPattern();

    [GeneratedRegex(@"[0-9a-fA-F]{64,}")]
    private static partial Regex LongHexPattern();
}
