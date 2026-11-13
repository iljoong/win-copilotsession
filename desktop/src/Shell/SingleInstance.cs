using System.Security.Principal;

namespace Shell;

/// <summary>
/// A per-user-session single-instance lock. The first instance holds a named mutex (by
/// handle, not thread ownership) and listens on a companion <c>.activate</c> event; later
/// instances find the mutex already present, signal the event, and exit.
/// </summary>
public sealed class SingleInstance : IDisposable
{
    private const string ActivateSuffix = ".activate";

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activate;
    private readonly RegisteredWaitHandle _registration;
    private int _disposed;

    private SingleInstance(Mutex mutex, EventWaitHandle activate)
    {
        _mutex = mutex;
        _activate = activate;
        _registration = ThreadPool.RegisterWaitForSingleObject(
            _activate,
            static (state, _) => ((SingleInstance)state!).OnActivate(),
            this,
            Timeout.Infinite,
            executeOnlyOnce: false);
    }

    public event Action? ActivationRequested;

    /// <summary>
    /// The lock name for the current user: <c>Local\CopilotSessionDashboard.Desktop.&lt;SID&gt;</c>.
    /// </summary>
    public static string NameForCurrentUser()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var sid = identity.User?.Value ?? throw new InvalidOperationException("Current user has no SID.");
        return $@"Local\CopilotSessionDashboard.Desktop.{sid}";
    }

    /// <summary>
    /// Returns the lock if this is the first instance for <paramref name="name"/>; otherwise
    /// <c>null</c>. The lock is held until disposed (or the process exits).
    /// </summary>
    public static SingleInstance? TryAcquire(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);

        var mutex = new Mutex(initiallyOwned: false, name, out var createdNew);
        if (!createdNew)
        {
            mutex.Dispose();
            return null;
        }

        EventWaitHandle? activate = null;
        try
        {
            activate = new EventWaitHandle(false, EventResetMode.AutoReset, name + ActivateSuffix);
            return new SingleInstance(mutex, activate);
        }
        catch
        {
            activate?.Dispose();
            mutex.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Asks the existing holder of <paramref name="name"/> to activate its window. Does nothing
    /// if no holder exists.
    /// </summary>
    public static void SignalExisting(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);

        if (EventWaitHandle.TryOpenExisting(name + ActivateSuffix, out var activate))
        {
            using (activate)
            {
                activate.Set();
            }
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _registration.Unregister(null);
        _activate.Dispose();
        _mutex.Dispose();
    }

    private void OnActivate()
    {
        if (Volatile.Read(ref _disposed) == 0)
        {
            ActivationRequested?.Invoke();
        }
    }
}
