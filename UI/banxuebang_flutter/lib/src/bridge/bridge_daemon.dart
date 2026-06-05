import 'dart:async';
import 'dart:convert';
import 'dart:io';

class BridgeDaemon {
  BridgeDaemon({
    required this.nodeCommand,
    required this.bridgeScriptPath,
    required this.workingDirectory,
    required this.environment,
  });

  final String nodeCommand;
  final String bridgeScriptPath;
  final String workingDirectory;
  final Map<String, String> environment;

  Process? _process;
  final StringBuffer _stdoutBuffer = StringBuffer();
  final Map<int, Completer<Map<String, dynamic>>> _pending =
      <int, Completer<Map<String, dynamic>>>{};
  int _nextRequestId = 0;
  Future<void>? _startFuture;
  bool _ready = false;
  Completer<void>? _readyCompleter;

  Future<Map<String, dynamic>> request(
    String command,
    Map<String, dynamic> payload, {
    required Duration timeout,
  }) async {
    await _ensureStarted();
    final process = _process;
    if (process == null) {
      throw StateError('Bridge daemon is not running.');
    }

    final id = _nextRequestId++;
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;

    final line = jsonEncode(<String, dynamic>{
      'id': id,
      'command': command,
      'payload': payload,
    });
    process.stdin.writeln(line);

    try {
      return await completer.future.timeout(timeout);
    } on TimeoutException {
      _pending.remove(id);
      throw StateError('Bridge command "$command" timed out.');
    }
  }

  Future<void> shutdown() async {
    _ready = false;
    final process = _process;
    _process = null;
    // 如果正在等待 ready，让等待者失败以防永久挂起
    final rc = _readyCompleter;
    if (rc != null && !rc.isCompleted) {
      rc.completeError(StateError('Bridge daemon stopped.'));
    }
    _readyCompleter = null;
    if (process == null) {
      return;
    }

    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(StateError('Bridge daemon stopped.'));
      }
    }
    _pending.clear();

    try {
      process.stdin.close();
    } catch (_) {
      // Process may already be gone.
    }

    await process.exitCode.timeout(
      const Duration(seconds: 2),
      onTimeout: () {
        process.kill(ProcessSignal.sigterm);
        return -1;
      },
    );
  }

  Future<void> _ensureStarted() async {
    if (_ready && _process != null) {
      return;
    }
    if (_startFuture != null) {
      await _startFuture;
      return;
    }

    _startFuture = _start();
    try {
      await _startFuture;
    } finally {
      _startFuture = null;
    }
  }

  Future<void> _start() async {
    await shutdown();

    final process = await Process.start(
      nodeCommand,
      <String>[bridgeScriptPath, '--daemon'],
      workingDirectory: workingDirectory,
      environment: environment,
      mode: ProcessStartMode.normal,
    );

    _process = process;
    _ready = false;
    _readyCompleter = Completer<void>();
    _stdoutBuffer.clear();

    process.stdout.listen(
      _onStdoutChunk,
      onDone: () => _handleProcessExit(process),
    );
    process.stderr.listen((List<int> chunk) {
      // Keep stderr out of the JSON protocol on stdout.
      stderr.add(chunk);
    });
    process.exitCode.then((_) => _handleProcessExit(process));

    await _waitForReady().timeout(
      const Duration(seconds: 15),
      onTimeout: () {
        process.kill(ProcessSignal.sigterm);
        throw StateError('Timed out waiting for the bridge daemon to start.');
      },
    );
  }

  // 等待 bridge daemon 就绪：用 Completer 事件驱动，避免 10ms 轮询占用 CPU。
  Future<void> _waitForReady() async {
    if (_ready) {
      return;
    }
    final completer = _readyCompleter;
    if (completer != null && !completer.isCompleted) {
      await completer.future;
    }
  }

  void _onStdoutChunk(List<int> chunk) {
    _stdoutBuffer.write(utf8.decode(chunk));
    while (true) {
      final buffered = _stdoutBuffer.toString();
      final newlineIndex = buffered.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }

      final line = buffered.substring(0, newlineIndex).trim();
      final remainder = buffered.substring(newlineIndex + 1);
      _stdoutBuffer
        ..clear()
        ..write(remainder);

      if (line.isEmpty) {
        continue;
      }
      _handleLine(line);
    }
  }

  void _handleLine(String line) {
    final decoded = jsonDecode(line);
    if (decoded is! Map) {
      return;
    }

    final envelope = decoded.map(
      (key, value) => MapEntry(key.toString(), value),
    );

    if (envelope['event'] == 'ready') {
      _ready = true;
      _readyCompleter?.complete();
      return;
    }

    final idValue = envelope['id'];
    final id = idValue is int ? idValue : int.tryParse('$idValue');
    if (id == null) {
      return;
    }

    final completer = _pending.remove(id);
    if (completer == null || completer.isCompleted) {
      return;
    }

    if (envelope['ok'] == true) {
      completer.complete(_coerceJsonMap(envelope['data']));
      return;
    }

    completer.completeError(
      StateError(
        (envelope['error'] ?? 'Bridge command failed').toString(),
      ),
    );
  }

  void _handleProcessExit(Process process) {
    if (!identical(_process, process)) {
      return;
    }

    _ready = false;
    _process = null;
    // 如果 daemon 在 ready 之前退出，唤醒等待者并报错
    final completer = _readyCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.completeError(
        StateError('Bridge daemon exited unexpectedly before becoming ready.'),
      );
    }
    _readyCompleter = null;
    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(StateError('Bridge daemon exited unexpectedly.'));
      }
    }
    _pending.clear();
  }

  Map<String, dynamic> _coerceJsonMap(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    return <String, dynamic>{};
  }
}
