namespace Shell.Tests;

public class ReadyLineTests
{
    [Fact]
    public void ParsesWellFormedReadyLine()
    {
        var line = """{"event":"ready","port":5173,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}""";

        var ok = ReadyLine.TryParse(line, out var signal);

        Assert.True(ok);
        Assert.NotNull(signal);
        Assert.Equal(5173, signal!.Port);
        Assert.Equal("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", signal.Token);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Dashboard: http://127.0.0.1:5173/")]
    [InlineData("""{"event":"ready","port":5173,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abc"}""")] // 63-char token
    [InlineData("""{"event":"ready","port":5173,"token":"0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"}""")] // uppercase hex
    [InlineData("""{"event":"ready","port":0,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}""")] // port 0
    [InlineData("""{"event":"ready","port":70000,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}""")] // port out of range
    [InlineData("""{"event":"ready","port":"5","token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}""")] // port as string
    [InlineData("""{"event":"ready","port":5.0,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}""")] // port with fractional notation
    [InlineData("""{"event":"ready","port":5e0,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}""")] // port with exponential notation
    [InlineData("""{"event":"ready","port":5173,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","x":1}""")] // extra key
    [InlineData("""{"port":5173,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}""")] // missing event
    [InlineData("""{"event":"ready","port":5173,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef""")] // truncated JSON
    [InlineData("""[{"event":"ready","port":5173,"token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}]""")] // array, not object
    public void RejectsMalformedOrDisallowedLines(string line)
    {
        var ok = ReadyLine.TryParse(line, out var signal);

        Assert.False(ok);
        Assert.Null(signal);
    }
}
