namespace Shell.Tests;

public class SingleInstanceTests
{
    private static string UniqueName() => $@"Local\CopilotSessionDashboard.Tests.{Guid.NewGuid():N}";

    [Fact]
    public void SecondAcquireReturnsNullWhileFirstIsHeld()
    {
        var name = UniqueName();
        using var first = SingleInstance.TryAcquire(name);

        Assert.NotNull(first);
        Assert.Null(SingleInstance.TryAcquire(name));
    }

    [Fact]
    public async Task SignalExistingRaisesActivationRequestedOnHolder()
    {
        var name = UniqueName();
        using var holder = SingleInstance.TryAcquire(name);
        Assert.NotNull(holder);

        var activated = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        holder!.ActivationRequested += () => activated.TrySetResult();

        SingleInstance.SignalExisting(name);

        await activated.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void AcquireSucceedsAfterHolderDisposes()
    {
        var name = UniqueName();
        var first = SingleInstance.TryAcquire(name);
        Assert.NotNull(first);
        first!.Dispose();

        using var second = SingleInstance.TryAcquire(name);

        Assert.NotNull(second);
    }
}
