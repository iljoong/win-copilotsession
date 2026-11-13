using System.Runtime.InteropServices;

namespace Shell;

/// <summary>
/// Releases the console that <c>dotnet.exe</c> (a console host) gives the shell when it is
/// launched as <c>dotnet CopilotSessionDashboard.dll</c>, so no console window lingers. When
/// started from the GUI apphost there is no console and this does nothing.
/// </summary>
public static class ConsoleDetach
{
    public static void IfHostedByDotnet()
    {
        if (GetConsoleWindow() != IntPtr.Zero)
        {
            FreeConsole();
        }
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FreeConsole();
}
