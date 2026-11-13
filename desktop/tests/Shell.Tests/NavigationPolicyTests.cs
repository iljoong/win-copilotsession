namespace Shell.Tests;

public class NavigationPolicyTests
{
    [Theory]
    [InlineData("http://127.0.0.1:5000/")]
    [InlineData("http://127.0.0.1:5000/api/x?y=1")]
    public void AllowsLoopbackHttpOnExactPort(string url)
    {
        var allowed = NavigationPolicy.IsAllowed(new Uri(url), 5000);

        Assert.True(allowed);
    }

    [Theory]
    [InlineData("https://127.0.0.1:5000/")]
    [InlineData("http://localhost:5000/")]
    [InlineData("http://127.0.0.1:5001/")]
    [InlineData("file:///C:/")]
    [InlineData("about:blank")]
    [InlineData("http://127.0.0.1.evil.test:5000/")]
    [InlineData("http://x@127.0.0.1:5000/")]
    public void RejectsAnythingOtherThanExactLoopbackMatch(string url)
    {
        var allowed = NavigationPolicy.IsAllowed(new Uri(url), 5000);

        Assert.False(allowed);
    }
}
