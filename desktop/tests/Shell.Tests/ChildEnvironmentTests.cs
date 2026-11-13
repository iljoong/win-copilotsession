namespace Shell.Tests;

public class ChildEnvironmentTests
{
    [Theory]
    [InlineData("NODE_OPTIONS")]
    [InlineData("node_path")]
    [InlineData("NODE_INSPECT_RESUME_ON_START")]
    [InlineData("NODE_REPL_EXTERNAL_MODULE")]
    public void RemovesNodePrefixedKeysCaseInsensitively(string key)
    {
        var parent = new Dictionary<string, string?>
        {
            [key] = "whatever",
            ["PATH"] = "C:\\Windows",
        };

        var result = ChildEnvironment.Build(parent);

        Assert.DoesNotContain(key, result.Keys, StringComparer.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("PATH")]
    [InlineData("SystemRoot")]
    [InlineData("LOCALAPPDATA")]
    [InlineData("USERPROFILE")]
    [InlineData("COPILOT_HOME")]
    public void PreservesNonNodeKeys(string key)
    {
        var parent = new Dictionary<string, string?>
        {
            [key] = "some-value",
            ["NODE_OPTIONS"] = "--inspect",
        };

        var result = ChildEnvironment.Build(parent);

        Assert.True(result.ContainsKey(key));
        Assert.Equal("some-value", result[key]);
    }

    [Fact]
    public void RemovesNullValuedEntries()
    {
        var parent = new Dictionary<string, string?>
        {
            ["SOME_NULL_VAR"] = null,
            ["PATH"] = "C:\\Windows",
        };

        var result = ChildEnvironment.Build(parent);

        Assert.False(result.ContainsKey("SOME_NULL_VAR"));
        Assert.True(result.ContainsKey("PATH"));
    }
}
