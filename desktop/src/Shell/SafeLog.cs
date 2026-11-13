using System.IO;
using System.Text;

namespace Shell;

/// <summary>
/// Appends timestamped, redacted lines to <c>shell.log</c> under a writable state directory,
/// rotating the file at 1 MB (<c>.1</c> &#8594; <c>.2</c> &#8594; <c>.3</c>, oldest dropped) so
/// the log never grows without bound. Logging failures (disk full, permission denied, etc.)
/// are swallowed: a broken log must never crash the shell.
/// </summary>
public sealed class SafeLog
{
    private const long MaxBytes = 1_048_576;

    private readonly string _logDir;
    private readonly string _logPath;
    private readonly object _lock = new();

    public SafeLog(string logDir)
    {
        ArgumentNullException.ThrowIfNull(logDir);

        _logDir = logDir;
        _logPath = Path.Combine(logDir, "shell.log");

        TryCreateLogDir();
    }

    /// <summary>
    /// Redacts and appends <paramref name="message"/> as one timestamped line. Never throws.
    /// </summary>
    public void Write(string message)
    {
        ArgumentNullException.ThrowIfNull(message);

        var redacted = LogRedactor.Redact(message);
        var line = $"{DateTimeOffset.UtcNow:O} {redacted}{Environment.NewLine}";
        var bytes = Encoding.UTF8.GetBytes(line);

        lock (_lock)
        {
            try
            {
                TryCreateLogDir();

                var existingLength = File.Exists(_logPath) ? new FileInfo(_logPath).Length : 0;
                if (existingLength + bytes.Length > MaxBytes)
                {
                    Rotate();
                }

                using var stream = new FileStream(_logPath, FileMode.Append, FileAccess.Write, FileShare.Read);
                stream.Write(bytes);
            }
            catch (IOException)
            {
                // Swallow: logging must never crash the shell.
            }
            catch (UnauthorizedAccessException)
            {
                // Swallow: logging must never crash the shell.
            }
        }
    }

    private void Rotate()
    {
        var path1 = _logPath + ".1";
        var path2 = _logPath + ".2";
        var path3 = _logPath + ".3";

        if (File.Exists(path3))
        {
            File.Delete(path3);
        }

        if (File.Exists(path2))
        {
            File.Move(path2, path3);
        }

        if (File.Exists(path1))
        {
            File.Move(path1, path2);
        }

        if (File.Exists(_logPath))
        {
            File.Move(_logPath, path1);
        }
    }

    private void TryCreateLogDir()
    {
        try
        {
            Directory.CreateDirectory(_logDir);
        }
        catch (IOException)
        {
            // Swallow: logging must never crash the shell.
        }
        catch (UnauthorizedAccessException)
        {
            // Swallow: logging must never crash the shell.
        }
    }
}
