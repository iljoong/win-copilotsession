using System.Diagnostics;

namespace Shell.Tests;

public class BackendSupervisorTests
{
    private static readonly string NodeExePath = ResolveNodeExe();
    private static readonly string FixturePath = Path.Combine(AppContext.BaseDirectory, "fixtures", "fake-backend.mjs");

    [Fact]
    public async Task ReadyLineResolvesSessionAndStopExitsWithinGrace()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        var launch = NewLaunch("ready", scratch.Path);

        await using var session = await BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(10), log, CancellationToken.None);

        Assert.Equal(5173, session.Ready.Port);
        Assert.Equal(64, session.Ready.Token.Length);

        await session.StopAsync(TimeSpan.FromSeconds(5));

        var exitCode = await session.Exited.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(0, exitCode);

        var logContent = await File.ReadAllTextAsync(Path.Combine(scratch.Path, "shell.log"));
        Assert.Contains("backend ready port=5173", logContent);
    }

    [Fact]
    public async Task ChunkedReadyLineIsAssembled()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        var launch = NewLaunch("chunked", scratch.Path);

        await using var session = await BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(10), log, CancellationToken.None);

        Assert.Equal(5173, session.Ready.Port);

        await session.StopAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(0, await session.Exited.WaitAsync(TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task NoiseBeforeReadyFailsWithInvalidReadyLine()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        var launch = NewLaunch("noise", scratch.Path);

        var failure = await Assert.ThrowsAsync<StartupFailure>(
            () => BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(10), log, CancellationToken.None));

        Assert.Equal(StartupFailureReason.InvalidReadyLine, failure.Reason);
    }

    [Fact]
    public async Task EarlyExitFailsWithExitedBeforeReadyAndRedactedStderrDetail()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        var launch = NewLaunch("exit-early", scratch.Path);

        var failure = await Assert.ThrowsAsync<StartupFailure>(
            () => BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(10), log, CancellationToken.None));

        Assert.Equal(StartupFailureReason.ExitedBeforeReady, failure.Reason);
        Assert.Contains("ownership marker missing", failure.Detail);
    }

    [Fact]
    public async Task SilentBackendFailsWithReadyTimeout()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        var launch = NewLaunch("silent", scratch.Path);

        var failure = await Assert.ThrowsAsync<StartupFailure>(
            () => BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(1), log, CancellationToken.None));

        Assert.Equal(StartupFailureReason.ReadyTimeout, failure.Reason);
    }

    [Fact]
    public async Task CancellingDuringSilentStartupThrowsOperationCanceledAndKillsChild()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        var pidFile = Path.Combine(scratch.Path, "child.pid");
        var launch = new BackendLaunch(
            NodeExePath,
            [FixturePath, "silent", pidFile],
            scratch.Path,
            ChildEnvironment.Build(CurrentEnvironment()));

        using var cts = new CancellationTokenSource();
        var startTask = BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(10), log, cts.Token);

        // Give the fixture a moment to start and record its PID before we cancel, so we can
        // verify afterwards that cancellation actually killed it rather than orphaning it.
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (!File.Exists(pidFile) && DateTime.UtcNow < deadline)
        {
            await Task.Delay(10);
        }

        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(() => startTask);

        Assert.True(File.Exists(pidFile), "Expected the fixture to have recorded its PID before cancellation.");
        var childPid = int.Parse(await File.ReadAllTextAsync(pidFile));

        try
        {
            using var child = Process.GetProcessById(childPid);
            var exitedDeadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
            while (!child.HasExited && DateTime.UtcNow < exitedDeadline)
            {
                await Task.Delay(20);
            }

            Assert.True(child.HasExited, "Expected cancellation to kill the backend child process.");
        }
        catch (ArgumentException)
        {
            // The process has already fully exited and been reaped; that is success too.
        }
    }

    [Fact]
    public async Task NodeOptionsFromParentIsNotInherited()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);

        var previousNodeOptions = Environment.GetEnvironmentVariable("NODE_OPTIONS");
        Environment.SetEnvironmentVariable("NODE_OPTIONS", "--require=x");
        try
        {
            var launch = new BackendLaunch(
                NodeExePath,
                [FixturePath, "env"],
                scratch.Path,
                ChildEnvironment.Build(CurrentEnvironment()));

            await using var session = await BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(10), log, CancellationToken.None);
            await session.StopAsync(TimeSpan.FromSeconds(5));

            var logContent = await File.ReadAllTextAsync(Path.Combine(scratch.Path, "shell.log"));
            Assert.Contains("unset", logContent);
            Assert.DoesNotContain("--require=x", logContent);
        }
        finally
        {
            Environment.SetEnvironmentVariable("NODE_OPTIONS", previousNodeOptions);
        }
    }

    [Fact]
    public void DisposingTheJobKillsABackendThatIgnoresStdin()
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = NodeExePath,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add(FixturePath);
        startInfo.ArgumentList.Add("silent");

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start fixture process.");
        using var job = new JobObject();
        job.Assign(process);

        Assert.False(process.HasExited);

        job.Dispose();

        var exited = process.WaitForExit(TimeSpan.FromSeconds(5));
        Assert.True(exited, "Expected the job close to kill the backend process.");
    }

    [Fact]
    public async Task MissingNodeExeFailsWithNodeMissing()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        var launch = new BackendLaunch(
            Path.Combine(scratch.Path, "does-not-exist.exe"),
            [FixturePath, "ready"],
            scratch.Path,
            ChildEnvironment.Build(CurrentEnvironment()));

        var failure = await Assert.ThrowsAsync<StartupFailure>(
            () => BackendSupervisor.StartAsync(launch, TimeSpan.FromSeconds(10), log, CancellationToken.None));

        Assert.Equal(StartupFailureReason.NodeMissing, failure.Reason);
    }

    [Fact]
    public async Task SafeLogRotatesAtOneMegabyteAndNeverWritesTheToken()
    {
        using var scratch = new ScratchDir();
        var log = new SafeLog(scratch.Path);
        const string token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 64 lowercase hex chars

        // Each round is one big single-line write, comfortably under 1 MB by itself but
        // over half of it, so every other round forces a rotation. Writing five distinguishable
        // rounds walks the file through the full .1 -> .2 -> .3 cascade and off the end (dropped):
        // after round 5, shell.log/.1/.2/.3 hold rounds 5/4/3/2 and round 1 is gone everywhere.
        string Round(int number) => $"round={number} token={token} {new string('x', 900_000)}";

        for (var round = 1; round <= 5; round++)
        {
            log.Write(Round(round));
        }

        var logPath = Path.Combine(scratch.Path, "shell.log");
        var path1 = logPath + ".1";
        var path2 = logPath + ".2";
        var path3 = logPath + ".3";

        Assert.True(File.Exists(logPath));
        Assert.True(File.Exists(path1));
        Assert.True(File.Exists(path2));
        Assert.True(File.Exists(path3));
        Assert.True(new FileInfo(logPath).Length <= 1_048_576);

        var current = await File.ReadAllTextAsync(logPath);
        var rotated1 = await File.ReadAllTextAsync(path1);
        var rotated2 = await File.ReadAllTextAsync(path2);
        var rotated3 = await File.ReadAllTextAsync(path3);

        Assert.Contains("round=5", current);
        Assert.Contains("round=4", rotated1);
        Assert.Contains("round=3", rotated2);
        Assert.Contains("round=2", rotated3);

        foreach (var content in new[] { current, rotated1, rotated2, rotated3 })
        {
            Assert.DoesNotContain("round=1", content);
            Assert.DoesNotContain(token, content);
        }
    }

    private static BackendLaunch NewLaunch(string mode, string workingDirectory) =>
        new(NodeExePath, [FixturePath, mode], workingDirectory, ChildEnvironment.Build(CurrentEnvironment()));

    private static Dictionary<string, string?> CurrentEnvironment()
    {
        var env = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            env[(string)entry.Key] = (string?)entry.Value;
        }

        return env;
    }

    private static string ResolveNodeExe()
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var dir in pathEnv.Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(dir))
            {
                continue;
            }

            var candidate = Path.Combine(dir, "node.exe");
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new InvalidOperationException(
            "node.exe was not found on PATH. BackendSupervisorTests requires a dev Node install on PATH; install Node or add it to PATH before running these tests.");
    }

    private sealed class ScratchDir : IDisposable
    {
        public string Path { get; } = Directory.CreateTempSubdirectory("shell-tests-").FullName;

        public void Dispose()
        {
            try
            {
                Directory.Delete(Path, recursive: true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
