import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/github_models.dart';

/// 封装对 GitHub Contents API 的访问。
/// 文档：https://docs.github.com/en/rest/repos/contents
class GitHubService {
  GitHubService({
    required this.owner,
    required this.repo,
    this.token,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String owner;
  final String repo;

  /// 可选的 Personal Access Token，用于提高速率限制（未认证：60次/小时）。
  final String? token;

  final http.Client _client;

  static const String _baseUrl = 'https://api.github.com';

  Map<String, String> get _headers => <String, String>{
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    if ((token ?? '').isNotEmpty) 'Authorization': 'Bearer $token',
  };

  /// 列出指定路径下的文件和目录（默认根目录）。
  Future<List<GitHubEntry>> listContents({String path = ''}) async {
    final cleanPath = path.trim().replaceAll(RegExp(r'^/+|/+$'), '');
    final uri = Uri.parse(
      '$_baseUrl/repos/$owner/$repo/contents${cleanPath.isEmpty ? '' : '/$cleanPath'}',
    );

    final response = await _client.get(uri, headers: _headers).timeout(
      const Duration(seconds: 15),
    );

    if (response.statusCode == 404) {
      // 仓库或路径不存在
      return <GitHubEntry>[];
    }

    if (response.statusCode != 200) {
      throw StateError(
        'GitHub API error ${response.statusCode}: ${_extractMessage(response.body)}',
      );
    }

    final decoded = jsonDecode(response.body);

    // 单文件时 API 返回对象，目录时返回数组
    if (decoded is List) {
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(GitHubEntry.fromJson)
          .toList()
        ..sort(_compareEntries);
    }

    // 单文件路径直接返回包装成列表
    if (decoded is Map<String, dynamic>) {
      return <GitHubEntry>[GitHubEntry.fromJson(decoded)];
    }

    return <GitHubEntry>[];
  }

  /// 获取单个文件内容（仅限 < 1 MB 的文件）。
  Future<GitHubFileContent> getFileContent(String path) async {
    final cleanPath = path.trim().replaceAll(RegExp(r'^/+'), '');
    final uri = Uri.parse('$_baseUrl/repos/$owner/$repo/contents/$cleanPath');

    final response = await _client.get(uri, headers: _headers).timeout(
      const Duration(seconds: 15),
    );

    if (response.statusCode != 200) {
      throw StateError(
        'GitHub API error ${response.statusCode}: ${_extractMessage(response.body)}',
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) {
      throw StateError('Unexpected response format for file content.');
    }

    return GitHubFileContent.fromJson(decoded);
  }

  /// 下载文件的原始字节（通过 download_url）。
  Future<List<int>> downloadRaw(String downloadUrl) async {
    final uri = Uri.parse(downloadUrl);
    final response = await _client.get(uri).timeout(
      const Duration(seconds: 30),
    );
    if (response.statusCode != 200) {
      throw StateError('Download failed: HTTP ${response.statusCode}');
    }
    return response.bodyBytes;
  }

  String _extractMessage(String body) {
    try {
      final json = jsonDecode(body);
      if (json is Map && json['message'] != null) {
        return json['message'].toString();
      }
    } catch (_) {}
    return body.length > 120 ? '${body.substring(0, 120)}…' : body;
  }

  /// 目录排在文件前面，各自按名称字母排序。
  static int _compareEntries(GitHubEntry a, GitHubEntry b) {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.toLowerCase().compareTo(b.name.toLowerCase());
  }

  void dispose() => _client.close();
}
