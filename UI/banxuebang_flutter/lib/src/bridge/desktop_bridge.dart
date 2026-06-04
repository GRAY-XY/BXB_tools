import 'dart:convert';
import 'dart:io';

import '../models/models.dart';

class DesktopBridge {
  DesktopBridge({String? nodeCommand})
    : _nodeCommand = nodeCommand ?? Platform.environment['NODE_BINARY'];

  final String? _nodeCommand;
  late final Directory _runtimeRoot = _resolveRuntimeRoot();

  File get _bridgeScript =>
      File('${_runtimeRoot.path}/desktop-shell/node_bridge.js');

  Future<DashboardData> loadDashboard() async {
    final payload = await _run('dashboard');
    return DashboardData.fromJson(payload);
  }

  Future<DashboardData> loginInBrowser() async {
    final payload = await _run('login');
    return DashboardData.fromJson(payload);
  }

  Future<DashboardData> loginWithCredentials({
    required String username,
    required String password,
  }) async {
    final payload = await _run('login-with-credentials', {
      'username': username,
      'password': password,
    });
    return DashboardData.fromJson(payload);
  }

  Future<DashboardData> logout() async {
    final payload = await _run('logout');
    return DashboardData.fromJson(payload);
  }

  Future<DashboardData> setTerm(String termId) async {
    final payload = await _run('set-term', {'termId': termId});
    return DashboardData.fromJson(payload);
  }

  Future<DashboardData> setSubject({
    String? subjectId,
    String? subjectName,
    String? classId,
  }) async {
    final payload = await _run('set-subject', <String, dynamic>{
      if ((subjectId ?? '').trim().isNotEmpty) 'subjectId': subjectId,
      if ((subjectName ?? '').trim().isNotEmpty) 'subjectName': subjectName,
      if ((classId ?? '').trim().isNotEmpty) 'classId': classId,
    });
    return DashboardData.fromJson(payload);
  }

  Future<TaskDetail> openTask(String taskId) async {
    final payload = await _run('open-task', {'taskId': taskId});
    return TaskDetail.fromJson(payload);
  }

  Future<AttachmentDownload> downloadAttachment({
    required String taskId,
    required String fileId,
  }) async {
    final payload = await _run('download-attachment', {
      'taskId': taskId,
      'fileId': fileId,
    });
    return AttachmentDownload.fromJson(payload);
  }

  Future<JsonMap> submitTask({
    required String taskId,
    required String remark,
    required List<String> filePaths,
  }) async {
    return _run('submit-task', {
      'taskId': taskId,
      'remark': remark,
      'filePaths': filePaths,
    });
  }

  Future<List<PrivateContact>> listPrivateContacts() async {
    final payload = await _run('list-private-contacts');
    final contactsData = payload['contacts'];
    if (contactsData is! List) {
      return <PrivateContact>[];
    }
    return contactsData
        .map((item) => item is Map
            ? PrivateContact.fromJson(
                item.map((k, v) => MapEntry(k.toString(), v)),
              )
            : null)
        .whereType<PrivateContact>()
        .toList();
  }

  Future<List<PrivateMessage>> getPrivateMessageThread(
    PrivateContact contact,
  ) async {
    final payload = await _run('get-private-thread', {
      'contact': contact.raw ?? {},
      'size': 50,
    });
    final messagesData = payload['messages'];
    if (messagesData is! List) {
      return <PrivateMessage>[];
    }
    return messagesData
        .map((item) => item is Map
            ? PrivateMessage.fromJson(
                item.map((k, v) => MapEntry(k.toString(), v)),
              )
            : null)
        .whereType<PrivateMessage>()
        .toList();
  }

  Future<PrivateMessage> sendPrivateMessage(
    PrivateContact contact,
    String content,
  ) async {
    final payload = await _run('send-private-message', {
      'contact': contact.raw ?? {},
      'content': content,
    });
    final messageData = payload['message'];
    if (messageData is! Map) {
      throw StateError('Failed to send message: no message data returned');
    }
    return PrivateMessage.fromJson(
      messageData.map((k, v) => MapEntry(k.toString(), v)),
    );
  }

  Future<void> openTarget(String target) async {
    if (target.trim().isEmpty) {
      return;
    }
    if (Platform.isMacOS) {
      await Process.run('open', [target]);
      return;
    }
    if (Platform.isWindows) {
      await Process.run('cmd', ['/c', 'start', '', target]);
      return;
    }
    if (Platform.isLinux) {
      await Process.run('xdg-open', [target]);
    }
  }

  Future<JsonMap> _run(
    String command, [
    JsonMap payload = const <String, dynamic>{},
  ]) async {
    final nodeCommand = _resolveNodeCommand();
    ProcessResult process;
    try {
      process = await Process.run(
        nodeCommand,
        <String>[_bridgeScript.path, command, jsonEncode(payload)],
        workingDirectory: _runtimeRoot.path,
        environment: _buildRuntimeEnv(),
      );
    } on ProcessException catch (error) {
      throw StateError(
        'Failed to start desktop runtime at "$nodeCommand". ${error.message}',
      );
    }

    final stdoutText = process.stdout?.toString().trim() ?? '';
    final stderrText = process.stderr?.toString().trim() ?? '';

    if (process.exitCode != 0 && stderrText.isNotEmpty) {
      throw StateError(stderrText);
    }

    if (stdoutText.isEmpty && stderrText.isNotEmpty) {
      throw StateError(stderrText);
    }

    if (stdoutText.isEmpty) {
      throw StateError('The desktop bridge returned no JSON for "$command".');
    }

    final decoded = jsonDecode(stdoutText);
    if (decoded is! Map) {
      throw StateError('Unexpected bridge response for "$command".');
    }

    final envelope = decoded.map(
      (key, value) => MapEntry(key.toString(), value),
    );
    final ok = envelope['ok'] == true;
    if (!ok) {
      throw StateError(
        (envelope['error'] ?? stderrText ?? 'Bridge command failed').toString(),
      );
    }

    return _coerceJsonMap(envelope['data']);
  }

  String _resolveNodeCommand() {
    final candidates = <String>[
      if ((_nodeCommand ?? '').trim().isNotEmpty) _nodeCommand!,
      ..._runtimeNodeCandidates(),
      if (Platform.isWindows) 'node.exe' else 'node',
    ];

    for (final candidate in candidates) {
      final trimmed = candidate.trim();
      if (trimmed.isEmpty) {
        continue;
      }
      if (!_looksLikePath(trimmed)) {
        return trimmed;
      }

      final file = File(trimmed);
      if (file.existsSync()) {
        return file.path;
      }
    }

    return Platform.isWindows ? 'node.exe' : 'node';
  }

  List<String> _runtimeNodeCandidates() {
    final executable = File(Platform.resolvedExecutable);
    final bundleRoot = executable.parent.parent;
    final runtimeRoot = _runtimeRoot;

    if (Platform.isWindows) {
      return <String>[
        '${runtimeRoot.path}\\runtime\\node.exe',
        '${executable.parent.path}\\runtime\\node.exe',
        '${bundleRoot.path}\\data\\flutter_assets\\runtime\\node.exe',
        '${runtimeRoot.path}\\build\\desktop-shell\\runtime\\node.exe',
      ];
    }

    return <String>[
      '${runtimeRoot.path}/runtime/node',
      '${bundleRoot.path}/Resources/runtime/node',
      '${runtimeRoot.path}/build/desktop-shell/runtime/node',
    ];
  }

  Map<String, String> _buildRuntimeEnv() {
    final environment = Map<String, String>.from(Platform.environment);
    final browsersPath = Directory(
      Platform.isWindows
          ? '${_runtimeRoot.path}\\runtime\\ms-playwright'
          : '${_runtimeRoot.path}/runtime/ms-playwright',
    );

    if (browsersPath.existsSync()) {
      environment['PLAYWRIGHT_BROWSERS_PATH'] = browsersPath.path;
    }

    return environment;
  }

  bool _looksLikePath(String value) {
    return value.contains('/') || value.contains('\\') || value.startsWith('.');
  }

  JsonMap _coerceJsonMap(dynamic value) {
    if (value is JsonMap) {
      return value;
    }
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    return <String, dynamic>{};
  }

  Directory _resolveRuntimeRoot() {
    final executable = File(Platform.resolvedExecutable);
    final bundleRoot = executable.parent.parent;
    final override = (Platform.environment['BXB_RUNTIME_ROOT'] ?? '').trim();
    final directCandidates = <Directory>[
      if (override.isNotEmpty) Directory(override),
      if (Platform.isMacOS)
        Directory('${bundleRoot.path}/Resources/app_runtime'),
      if (Platform.isWindows)
        Directory('${executable.parent.path}\\app_runtime'),
    ];

    for (final candidate in directCandidates) {
      if (_containsBridge(candidate)) {
        return candidate;
      }
    }

    final ancestorCandidates = <Directory>[
      Directory.current,
      executable.parent,
      executable.parent.parent,
      executable.parent.parent.parent,
    ];

    for (final candidate in ancestorCandidates) {
      final match = _walkUpForRuntimeRoot(candidate);
      if (match != null) {
        return match;
      }
    }

    throw StateError(
      'Could not find the desktop runtime. Expected desktop-shell/node_bridge.js in an app bundle runtime payload or ancestor directory.',
    );
  }

  bool _containsBridge(Directory root) {
    return File('${root.path}/desktop-shell/node_bridge.js').existsSync();
  }

  Directory? _walkUpForRuntimeRoot(Directory start) {
    Directory current = start.absolute;
    while (true) {
      if (_containsBridge(current)) {
        return current;
      }

      final parent = current.parent;
      if (parent.path == current.path) {
        return null;
      }
      current = parent;
    }
  }
}
