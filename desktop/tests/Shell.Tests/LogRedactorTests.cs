namespace Shell.Tests;

public class LogRedactorTests
{
    private const string Hex64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    [Fact]
    public void RedactsBareLongHexStrings()
    {
        var text = $"token value was {Hex64} in the log";

        var result = LogRedactor.Redact(text);

        Assert.DoesNotContain(Hex64, result);
        Assert.Contains("[redacted]", result);
    }

    [Fact]
    public void RedactsTokenAssignment()
    {
        var text = "connecting with token=abc and other=stuff";

        var result = LogRedactor.Redact(text);

        Assert.DoesNotContain("token=abc", result);
        Assert.Contains("token=[redacted]", result);
    }

    [Fact]
    public void RedactsUrlQueryStrings()
    {
        var text = $"GET http://127.0.0.1:5000/api?token={Hex64}";

        var result = LogRedactor.Redact(text);

        Assert.DoesNotContain(Hex64, result);
        Assert.DoesNotContain("?token=", result);
        Assert.Contains("http://127.0.0.1:5000/api?[redacted]", result);
    }

    [Fact]
    public void LeavesOrdinarySentencesUnchanged()
    {
        const string text = "Server started on port 5173 and is ready for connections.";

        var result = LogRedactor.Redact(text);

        Assert.Equal(text, result);
    }
}
