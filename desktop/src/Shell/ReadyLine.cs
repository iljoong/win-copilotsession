using System.Diagnostics.CodeAnalysis;
using System.Text.Json;

namespace Shell;

/// <summary>
/// The sidecar backend's single-line ready announcement: port and bearer token.
/// </summary>
public sealed record ReadySignal(int Port, string Token);

/// <summary>
/// Parses the desktop sidecar's stdout "ready" line into a <see cref="ReadySignal"/>.
/// </summary>
public static class ReadyLine
{
    /// <summary>
    /// Attempts to parse <paramref name="line"/> as the strict ready announcement:
    /// exactly the keys <c>event</c> (must be <c>"ready"</c>), <c>port</c> (integer 1..65535),
    /// and <c>token</c> (64-character lowercase hex string). Any other shape is rejected.
    /// </summary>
    public static bool TryParse(string line, [NotNullWhen(true)] out ReadySignal? signal)
    {
        signal = null;

        if (string.IsNullOrWhiteSpace(line))
        {
            return false;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            return false;
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            string? eventName = null;
            int? port = null;
            string? token = null;
            var propertyCount = 0;

            foreach (var property in root.EnumerateObject())
            {
                propertyCount++;

                switch (property.Name)
                {
                    case "event":
                        if (property.Value.ValueKind != JsonValueKind.String)
                        {
                            return false;
                        }

                        eventName = property.Value.GetString();
                        break;

                    case "port":
                        if (property.Value.ValueKind != JsonValueKind.Number
                            || !property.Value.TryGetInt32(out var parsedPort))
                        {
                            return false;
                        }

                        port = parsedPort;
                        break;

                    case "token":
                        if (property.Value.ValueKind != JsonValueKind.String)
                        {
                            return false;
                        }

                        token = property.Value.GetString();
                        break;

                    default:
                        return false;
                }
            }

            if (propertyCount != 3
                || eventName != "ready"
                || port is null or < 1 or > 65535
                || token is null
                || !IsLowercaseHex64(token))
            {
                return false;
            }

            signal = new ReadySignal(port.Value, token);
            return true;
        }
    }

    private static bool IsLowercaseHex64(string value)
    {
        if (value.Length != 64)
        {
            return false;
        }

        foreach (var c in value)
        {
            var isLowerHexDigit = (c is >= '0' and <= '9') || (c is >= 'a' and <= 'f');
            if (!isLowerHexDigit)
            {
                return false;
            }
        }

        return true;
    }
}
