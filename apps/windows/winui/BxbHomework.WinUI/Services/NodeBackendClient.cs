using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BxbHomework.WinUI.Services;

public sealed class BackendProgressEventArgs : EventArgs
{
    public string Id { get; init; } = "";
    public string Method { get; init; } = "";
    public JsonElement Result { get; init; }
}

public sealed class NodeBackendClient : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _startLock = new(1, 1);
    private Process? _process;
    private StreamWriter? _stdin;
    private int _nextId;

    public event EventHandler<string>? LogReceived;
    public event EventHandler<BackendProgressEventArgs>? ProgressReceived;

    public bool IsRunning => _process is { HasExited: false };

    public async Task<JsonElement> InvokeAsync(string method, object? parameters = null, CancellationToken cancellationToken = default)
    {
        await EnsureStartedAsync(cancellationToken);

        var id = Interlocked.Increment(ref _nextId).ToString();
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, completion))
        {
            throw new InvalidOperationException("Backend request id collision.");
        }

        var request = new
        {
            id,
            method,
            @params = parameters ?? new { },
        };

        var payload = JsonSerializer.Serialize(request, JsonOptions);
        await _stdin!.WriteLineAsync(payload.AsMemory(), cancellationToken);
        await _stdin.FlushAsync(cancellationToken);

        await using var registration = cancellationToken.Register(() =>
        {
            if (_pending.TryRemove(id, out var source))
            {
                source.TrySetCanceled(cancellationToken);
            }
        });

        return await completion.Task;
    }

    public async Task EnsureStartedAsync(CancellationToken cancellationToken = default)
    {
        if (IsRunning)
        {
            return;
        }

        await _startLock.WaitAsync(cancellationToken);
        try
        {
            if (IsRunning)
            {
                return;
            }

            var runtime = FindBackendRuntime();
            var backendScript = Path.Combine(runtime.PayloadRoot, "backend", "bridge", "winui-backend.js");
            if (!File.Exists(backendScript))
            {
                throw new FileNotFoundException("Cannot find WinUI backend script.", backendScript);
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = runtime.NodeExe,
                WorkingDirectory = runtime.PayloadRoot,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            if (runtime.IsPackaged)
            {
                startInfo.Environment["BXB_WINUI_PACKAGED"] = "1";
                startInfo.Environment["BXB_WINUI_APP_ROOT"] = AppContext.BaseDirectory;
                startInfo.Environment["BXB_WINUI_PAYLOAD_ROOT"] = runtime.PayloadRoot;
            }
            startInfo.ArgumentList.Add(backendScript);

            _process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            _process.Exited += (_, _) =>
            {
                FailPending(new InvalidOperationException("Node backend exited."));
                LogReceived?.Invoke(this, "Node backend exited.");
            };

            if (!_process.Start())
            {
                throw new InvalidOperationException("Failed to start Node backend.");
            }

            _stdin = _process.StandardInput;
            _ = Task.Run(() => ReadStdoutLoopAsync(_process));
            _ = Task.Run(() => ReadStderrLoopAsync(_process));
        }
        finally
        {
            _startLock.Release();
        }
    }

    private async Task ReadStdoutLoopAsync(Process process)
    {
        try
        {
            while (!process.HasExited)
            {
                var line = await process.StandardOutput.ReadLineAsync();
                if (line is null)
                {
                    break;
                }

                HandleBackendLine(line);
            }
        }
        catch (Exception error)
        {
            FailPending(error);
        }
    }

    private async Task ReadStderrLoopAsync(Process process)
    {
        try
        {
            while (!process.HasExited)
            {
                var line = await process.StandardError.ReadLineAsync();
                if (line is null)
                {
                    break;
                }

                LogReceived?.Invoke(this, line);
            }
        }
        catch (Exception error)
        {
            LogReceived?.Invoke(this, error.Message);
        }
    }

    private void HandleBackendLine(string line)
    {
        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        var id = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
        if (root.TryGetProperty("event", out var eventElement))
        {
            var eventName = eventElement.GetString();
            if (eventName == "progress")
            {
                ProgressReceived?.Invoke(this, new BackendProgressEventArgs
                {
                    Id = id ?? "",
                    Method = root.TryGetProperty("method", out var methodElement) ? methodElement.GetString() ?? "" : "",
                    Result = root.TryGetProperty("result", out var resultElement) ? resultElement.Clone() : default,
                });
                return;
            }
        }

        if (string.IsNullOrWhiteSpace(id) || !_pending.TryRemove(id, out var completion))
        {
            LogReceived?.Invoke(this, line);
            return;
        }

        if (root.TryGetProperty("ok", out var okElement) && okElement.GetBoolean())
        {
            completion.TrySetResult(root.GetProperty("result").Clone());
            return;
        }

        var message = "Backend request failed.";
        var stack = string.Empty;
        if (root.TryGetProperty("error", out var errorElement))
        {
            if (errorElement.TryGetProperty("message", out var messageElement))
            {
                message = messageElement.GetString() ?? message;
            }
            if (errorElement.TryGetProperty("stack", out var stackElement))
            {
                stack = stackElement.GetString() ?? string.Empty;
            }
        }

        completion.TrySetException(new BackendException(message, stack));
    }

    private void FailPending(Exception error)
    {
        foreach (var request in _pending)
        {
            if (_pending.TryRemove(request.Key, out var completion))
            {
                completion.TrySetException(error);
            }
        }
    }

    private sealed record BackendRuntime(string PayloadRoot, string NodeExe, bool IsPackaged);

    private static BackendRuntime FindBackendRuntime()
    {
        var appDirectory = AppContext.BaseDirectory;
        var packagedPayload = Path.Combine(appDirectory, "resources", "payload");
        var packagedNode = Path.Combine(appDirectory, "resources", "node", "node.exe");
        if (File.Exists(Path.Combine(packagedPayload, "backend", "bridge", "winui-backend.js")) && File.Exists(packagedNode))
        {
            return new BackendRuntime(packagedPayload, packagedNode, true);
        }

        var repoRoot = FindRepoRoot();
        return new BackendRuntime(repoRoot, "node", false);
    }

    private static string FindRepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json"))
                && File.Exists(Path.Combine(directory.FullName, "backend", "bridge", "winui-backend.js")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        var sourcePath = Environment.ProcessPath;
        directory = sourcePath is null ? null : new FileInfo(sourcePath).Directory;
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json"))
                && File.Exists(Path.Combine(directory.FullName, "backend", "bridge", "winui-backend.js")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Cannot locate repository root for WinUI backend.");
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_stdin is not null)
            {
                await _stdin.DisposeAsync();
            }
        }
        catch
        {
            // Best-effort shutdown.
        }

        if (_process is { HasExited: false })
        {
            _process.Kill(entireProcessTree: true);
        }

        _process?.Dispose();
        _startLock.Dispose();
    }
}
