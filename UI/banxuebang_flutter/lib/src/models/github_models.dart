// GitHub API 相关模型

/// 仓库中单个文件或目录条目
class GitHubEntry {
  const GitHubEntry({
    required this.name,
    required this.path,
    required this.type,
    required this.size,
    required this.downloadUrl,
    required this.htmlUrl,
    required this.sha,
  });

  factory GitHubEntry.fromJson(Map<String, dynamic> json) {
    return GitHubEntry(
      name: (json['name'] ?? '').toString(),
      path: (json['path'] ?? '').toString(),
      type: (json['type'] ?? '').toString(), // 'file' or 'dir'
      size: json['size'] is int ? json['size'] as int : 0,
      downloadUrl: (json['download_url'] ?? '').toString(),
      htmlUrl: (json['html_url'] ?? '').toString(),
      sha: (json['sha'] ?? '').toString(),
    );
  }

  final String name;
  final String path;
  final String type;   // 'file' | 'dir'
  final int size;
  final String downloadUrl;
  final String htmlUrl;
  final String sha;

  bool get isDir => type == 'dir';
  bool get isFile => type == 'file';

  /// 文件扩展名（小写），目录返回空字符串
  String get extension {
    if (isDir) return '';
    final idx = name.lastIndexOf('.');
    if (idx < 0) return '';
    return name.substring(idx + 1).toLowerCase();
  }
}

/// 单个文件的内容（Base64 解码前的原始 API 响应）
class GitHubFileContent {
  const GitHubFileContent({
    required this.name,
    required this.path,
    required this.size,
    required this.content,
    required this.encoding,
    required this.htmlUrl,
    required this.downloadUrl,
    required this.sha,
  });

  factory GitHubFileContent.fromJson(Map<String, dynamic> json) {
    return GitHubFileContent(
      name: (json['name'] ?? '').toString(),
      path: (json['path'] ?? '').toString(),
      size: json['size'] is int ? json['size'] as int : 0,
      content: (json['content'] ?? '').toString(),
      encoding: (json['encoding'] ?? '').toString(),
      htmlUrl: (json['html_url'] ?? '').toString(),
      downloadUrl: (json['download_url'] ?? '').toString(),
      sha: (json['sha'] ?? '').toString(),
    );
  }

  final String name;
  final String path;
  final int size;
  final String content;   // Base64 encoded when encoding == 'base64'
  final String encoding;
  final String htmlUrl;
  final String downloadUrl;
  final String sha;
}
