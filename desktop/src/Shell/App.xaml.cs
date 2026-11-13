using System.Windows;

namespace Shell;

public partial class App : Application
{
    private SingleInstance? _instance;

    private void OnStartup(object sender, StartupEventArgs e)
    {
        var name = SingleInstance.NameForCurrentUser();
#if TESTING
        // Testing builds must never hand off to (or block) a running release app.
        name += ".Testing";
#endif
        _instance = SingleInstance.TryAcquire(name);
        if (_instance is null)
        {
            SingleInstance.SignalExisting(name);
            Shutdown();
            return;
        }

        ConsoleDetach.IfHostedByDotnet();

#if TESTING
        var window = new MainWindow(TestingOptions.FromArgs(e.Args));
#else
        var window = new MainWindow();
#endif
        _instance.ActivationRequested += () => Dispatcher.BeginInvoke(window.BringToFront);

        MainWindow = window;
        window.Show();
    }

    private void OnSessionEnding(object sender, SessionEndingCancelEventArgs e)
    {
        (MainWindow as MainWindow)?.StopForSessionEnd();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _instance?.Dispose();
        base.OnExit(e);
    }
}
