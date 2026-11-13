namespace Shell;

/// <summary>
/// Builds the environment block passed to the Node sidecar process: the parent process
/// environment with any <c>NODE_*</c> variable removed, so the backend cannot inherit
/// settings (such as <c>NODE_OPTIONS</c>) that could change its behavior at launch.
/// </summary>
public static class ChildEnvironment
{
    private const string RemovedPrefix = "NODE_";

    /// <summary>
    /// Returns a copy of <paramref name="parent"/> with null-valued entries and any key
    /// starting with <c>NODE_</c> (case-insensitive) removed. All other entries are preserved.
    /// </summary>
    public static IReadOnlyDictionary<string, string> Build(IReadOnlyDictionary<string, string?> parent)
    {
        ArgumentNullException.ThrowIfNull(parent);

        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var (key, value) in parent)
        {
            if (value is null)
            {
                continue;
            }

            if (key.StartsWith(RemovedPrefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            result[key] = value;
        }

        return result;
    }
}
