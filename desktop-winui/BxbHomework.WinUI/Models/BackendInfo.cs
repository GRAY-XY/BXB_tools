namespace BxbHomework.WinUI.Models;

public sealed record BackendInfo(
    string Name,
    string Version,
    string NodeVersion,
    string Platform,
    string RepoRoot,
    string SessionFile);
