using System.ComponentModel;
using System.Diagnostics;
using System.IO;

namespace Shell;

/// <summary>
/// Everything needed to start the Node sidecar: the executable, its arguments, the working
/// directory, and the exact environment block to give it (already filtered by
/// <see cref="ChildEnvironment.Build"/>).
/// </summary>
public sealed record BackendLaunch(
    string NodeExe,
    IReadOnlyList<string> Arguments,
    string WorkingDirectory,
    IReadOnlyDictionary<string, string> Environment)
{
    /// <summary>
    /// Builds the launch for the desktop sidecar: <c>node main.js --desktop --no-open --port 0</c>,
    /// run from the app's working directory with the parent environment stripped of any
    /// <c>NODE_*</c> variable.
    /// </summary>
    public static BackendLaunch ForApp(AppPaths paths, IReadOnlyDictionary<string, string?> parentEnv)
    {
        ArgumentNullException.ThrowIfNull(paths);
        ArgumentNullException.ThrowIfNull(parentEnv);

        return new BackendLaunch(
            NodeExe: paths.NodeExe,
            Arguments: [paths.ServerMain, "--desktop", "--no-open", "--port", "0"],
            WorkingDirectory: paths.AppWorkDir,
            Environment: ChildEnvironment.Build(parentEnv));
    }

#if TESTING
    /// <summary>
    /// Test-only overload that also pins the backend's data directory, so tests never touch
    /// the real <c>%LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data</c>.
    /// </summary>
    public static BackendLaunch ForApp(AppPaths paths, IReadOnlyDictionary<string, string?> parentEnv, string dataDir)
    {
        ArgumentNullException.ThrowIfNull(dataDir);

        var launch = ForApp(paths, parentEnv);
        return launch with { Arguments = [.. launch.Arguments, "--data-dir", dataDir] };
    }
#endif
}

/// <summary>
/// A running, ready Node sidecar: its announced <see cref="Ready"/> endpoint, a task that
/// completes with its exit code, and the means to shut it down.
/// </summary>
public sealed class BackendSession : IAsyncDisposable
{
    private readonly Process _process;
    private readonly JobObject _job;
    private readonly Task _stderrPump;
    private readonly object _stopLock = new();
    private Task? _stopTask;

    internal BackendSession(Process process, JobObject job, ReadySignal ready, Task<int> exited, Task stderrPump)
    {
        _process = process;
        _job = job;
        Ready = ready;
        Exited = exited;
        _stderrPump = stderrPump;
    }

    public ReadySignal Ready { get; }

    public Task<int> Exited { get; }

    /// <summary>
    /// Closes the sidecar's stdin, gives it up to <paramref name="grace"/> to exit on its own,
    /// then closes the job object, which kills it if it is still alive. Safe to call more than
    /// once; later calls await the same shutdown.
    /// </summary>
    public Task StopAsync(TimeSpan grace)
    {
        lock (_stopLock)
        {
            return _stopTask ??= StopCoreAsync(grace);
        }
    }

    private async Task StopCoreAsync(TimeSpan grace)
    {
        try
        {
            _process.StandardInput.Close();
        }
        catch (InvalidOperationException)
        {
        }
        catch (IOException)
        {
        }

        await Task.WhenAny(Exited, Task.Delay(grace)).ConfigureAwait(false);

        _job.Dispose();

        try
        {
            await Exited.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }

        try
        {
            await _stderrPump.ConfigureAwait(false);
        }
        catch
        {
            // The stderr pump only ever completes or is torn down by the job close above;
            // nothing it throws should fail shutdown.
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        _process.Dispose();
    }
}

/// <summary>
/// Starts the Node sidecar, waits for its single-line ready handshake on stdout, and reports
/// a precise <see cref="StartupFailure"/> when it cannot be brought up.
/// </summary>
public static class BackendSupervisor
{
    private const int StderrTailLines = 20;

    public static async Task<BackendSession> StartAsync(
        BackendLaunch launch,
        TimeSpan readyTimeout,
        SafeLog log,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(launch);
        ArgumentNullException.ThrowIfNull(log);

        if (!File.Exists(launch.NodeExe))
        {
            throw new StartupFailure(
                StartupFailureReason.NodeMissing,
                LogRedactor.Redact($"Node executable not found: {launch.NodeExe}"));
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = launch.NodeExe,
            WorkingDirectory = launch.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        foreach (var argument in launch.Arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        startInfo.Environment.Clear();
        foreach (var (key, value) in launch.Environment)
        {
            startInfo.Environment[key] = value;
        }

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var exitedTcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        process.Exited += (_, _) => exitedTcs.TrySetResult(SafeExitCode(process));

        var job = new JobObject();

        try
        {
            process.Start();
        }
        catch (Win32Exception ex)
        {
            job.Dispose();
            process.Dispose();
            throw new StartupFailure(
                StartupFailureReason.NodeMissing,
                LogRedactor.Redact($"Failed to start Node executable: {ex.Message}"));
        }

        try
        {
            job.Assign(process);
        }
        catch
        {
            job.Dispose();
            process.Kill(entireProcessTree: true);
            process.Dispose();
            throw;
        }

        var tail = new StderrTail(StderrTailLines);
        var stderrPump = PumpStderrAsync(process, log, tail);

        async Task<StartupFailure> BuildFailureAsync(StartupFailureReason reason)
        {
            job.Dispose();
            try
            {
                await stderrPump.ConfigureAwait(false);
            }
            catch
            {
                // Already captured in tail; nothing more to do.
            }

            process.Dispose();
            return new StartupFailure(reason, tail.Snapshot());
        }

        async Task<OperationCanceledException> BuildCancellationAsync()
        {
            job.Dispose();
            try
            {
                await stderrPump.ConfigureAwait(false);
            }
            catch
            {
                // Nothing left to capture; the caller is abandoning startup.
            }

            process.Dispose();
            return new OperationCanceledException(ct);
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(readyTimeout);

        try
        {
            var delayTask = Task.Delay(Timeout.InfiniteTimeSpan, timeoutCts.Token);
            // Intentionally CancellationToken.None: cancellation is observed via delayTask
            // (linked to ct) above, not by cancelling the read itself. If the read were
            // cancelled directly, it could win Task.WhenAny with a faulted task, bypassing
            // the delayTask branch's job/process disposal and leaking the Node child.
            var firstLineTask = process.StandardOutput.ReadLineAsync(CancellationToken.None).AsTask();

            var completed = await Task.WhenAny(firstLineTask, exitedTcs.Task, delayTask).ConfigureAwait(false);

            if (completed == delayTask)
            {
                // Observe (but ignore) a late result from the abandoned stdout read so it
                // never surfaces as an unobserved task exception.
                _ = firstLineTask.ContinueWith(static t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);

                if (ct.IsCancellationRequested)
                {
                    throw await BuildCancellationAsync().ConfigureAwait(false);
                }

                throw await BuildFailureAsync(StartupFailureReason.ReadyTimeout).ConfigureAwait(false);
            }

            var line = await firstLineTask.ConfigureAwait(false);

            if (line is not null && ReadyLine.TryParse(line, out var signal))
            {
                log.Write($"backend ready port={signal.Port}");
                DiscardRemainingStdout(process);
                return new BackendSession(process, job, signal, exitedTcs.Task, stderrPump);
            }

            if (line is null)
            {
                await exitedTcs.Task.ConfigureAwait(false);
                throw await BuildFailureAsync(StartupFailureReason.ExitedBeforeReady).ConfigureAwait(false);
            }

            throw await BuildFailureAsync(StartupFailureReason.InvalidReadyLine).ConfigureAwait(false);
        }
        catch (StartupFailure)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            // Dispose is idempotent: this is a safety net in case cancellation reached this
            // catch through a path other than the delayTask branch above, which already
            // disposes job/process itself.
            job.Dispose();
            process.Dispose();
            throw;
        }
        catch
        {
            job.Dispose();
            process.Dispose();
            throw;
        }
    }

    private static int SafeExitCode(Process process)
    {
        try
        {
            return process.ExitCode;
        }
        catch (InvalidOperationException)
        {
            return -1;
        }
    }

    private static void DiscardRemainingStdout(Process process)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                while (await process.StandardOutput.ReadLineAsync().ConfigureAwait(false) is not null)
                {
                }
            }
            catch
            {
                // The process has exited or the stream was disposed; nothing left to discard.
            }
        });
    }

    private static async Task PumpStderrAsync(Process process, SafeLog log, StderrTail tail)
    {
        try
        {
            string? line;
            while ((line = await process.StandardError.ReadLineAsync().ConfigureAwait(false)) is not null)
            {
                var redacted = LogRedactor.Redact(line);
                log.Write(redacted);
                tail.Add(redacted);
            }
        }
        catch
        {
            // The process has exited or the stream was disposed; nothing left to pump.
        }
    }

    private sealed class StderrTail(int capacity)
    {
        private readonly Queue<string> _lines = new();
        private readonly object _lock = new();

        public void Add(string line)
        {
            lock (_lock)
            {
                _lines.Enqueue(line);
                while (_lines.Count > capacity)
                {
                    _lines.Dequeue();
                }
            }
        }

        public string Snapshot()
        {
            lock (_lock)
            {
                return string.Join(Environment.NewLine, _lines);
            }
        }
    }
}
