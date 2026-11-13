namespace Shell.Tests;

public class AppPathsTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("rel\\path")]
    [InlineData("\\foo")]
    [InlineData("C:foo")]
    public void ReturnsNullForMissingOrRelativeLocalAppData(string? localAppData)
    {
        var result = AppPaths.Resolve(@"C:\Apps\CopilotSessionDashboard", localAppData);

        Assert.Null(result);
    }

    [Fact]
    public void ResolvesPathsUnderAppDirAndLocalAppData()
    {
        const string appDir = @"C:\사용자\Copilot Dashboard";
        const string localAppData = @"C:\사용자\Copilot Dashboard\AppData\Local";

        var result = AppPaths.Resolve(appDir, localAppData);

        Assert.NotNull(result);
        Assert.Equal(appDir, result!.AppDir);
        Assert.Equal(Path.Combine(appDir, "node", "node.exe"), result.NodeExe);
        Assert.Equal(Path.Combine(appDir, "app", "dist", "server", "main.js"), result.ServerMain);
        Assert.Equal(Path.Combine(appDir, "app"), result.AppWorkDir);
        Assert.Equal(Path.Combine(localAppData, "CopilotSessionDashboard", "desktop"), result.StateDir);
        Assert.Equal(Path.Combine(localAppData, "CopilotSessionDashboard", "desktop", "WebView2"), result.WebViewDir);
        Assert.Equal(Path.Combine(localAppData, "CopilotSessionDashboard", "desktop", "logs"), result.LogDir);
    }
}
