namespace BxbHomework.WinUI.Services;

public sealed class BackendException : Exception
{
    public BackendException(string message, string? stack = null)
        : base(string.IsNullOrWhiteSpace(stack) ? message : $"{message}\n{stack}")
    {
        Stack = stack ?? string.Empty;
    }

    public string Stack { get; }
}
