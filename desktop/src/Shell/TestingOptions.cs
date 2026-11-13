#if TESTING
using System.Globalization;

namespace Shell;

/// <summary>
/// Testing-build-only command-line switches: <c>--data-dir &lt;path&gt;</c> pins the backend's
/// data directory, and <c>--remote-debugging-port &lt;port&gt;</c> exposes CDP on loopback.
/// Unknown or malformed switches are ignored.
/// </summary>
public sealed record TestingOptions(string? DataDir, int? RemoteDebuggingPort)
{
    public static TestingOptions FromArgs(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);

        string? dataDir = null;
        int? port = null;

        for (var i = 0; i + 1 < args.Length; i++)
        {
            switch (args[i])
            {
                case "--data-dir":
                    dataDir = args[++i];
                    break;

                case "--remote-debugging-port":
                    if (int.TryParse(args[++i], NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
                        && parsed is >= 1 and <= 65535)
                    {
                        port = parsed;
                    }

                    break;
            }
        }

        return new TestingOptions(dataDir, port);
    }
}
#endif
