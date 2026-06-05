import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../models/github_models.dart';
import '../services/github_service.dart';
import '../theme/app_theme.dart';

// ─────────────────────────────────────────────────────────────────────────────
// 仓库配置
// ─────────────────────────────────────────────────────────────────────────────
const String _kOwner = 'igpig1226';
const String _kRepo = 'bxb-files';

// ─────────────────────────────────────────────────────────────────────────────
// 公开入口 Widget
// ─────────────────────────────────────────────────────────────────────────────

class FilesPage extends StatefulWidget {
  const FilesPage({super.key});

  @override
  State<FilesPage> createState() => _FilesPageState();
}

class _FilesPageState extends State<FilesPage> {
  late final GitHubService _github;

  // 导航栈：每个元素是一个路径字符串（根目录为空字符串 ''）
  final List<String> _pathStack = <String>[''];

  // 当前目录的内容
  List<GitHubEntry> _entries = <GitHubEntry>[];
  bool _loading = false;
  String? _error;

  // 当前打开预览的文件
  GitHubEntry? _selectedFile;
  String? _previewContent;     // 文本预览
  bool _loadingPreview = false;
  String? _previewError;
  bool _isImagePreview = false;
  List<int>? _imageBytes;

  String get _currentPath => _pathStack.last;
  bool get _atRoot => _pathStack.length == 1;

  @override
  void initState() {
    super.initState();
    _github = GitHubService(owner: _kOwner, repo: _kRepo);
    _loadCurrentPath();
  }

  @override
  void dispose() {
    _github.dispose();
    super.dispose();
  }

  // ── 数据加载 ────────────────────────────────────────────────────────────────

  Future<void> _loadCurrentPath() async {
    setState(() {
      _loading = true;
      _error = null;
      _entries = <GitHubEntry>[];
    });
    try {
      final entries = await _github.listContents(path: _currentPath);
      if (mounted) {
        setState(() => _entries = entries);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = e is StateError ? e.message : e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  void _navigateInto(GitHubEntry dir) {
    _pathStack.add(dir.path);
    _clearPreview();
    _loadCurrentPath();
  }

  void _navigateTo(int stackIndex) {
    if (stackIndex >= _pathStack.length - 1) return;
    _pathStack.removeRange(stackIndex + 1, _pathStack.length);
    _clearPreview();
    _loadCurrentPath();
  }

  // ── 文件预览 ─────────────────────────────────────────────────────────────────

  void _clearPreview() {
    setState(() {
      _selectedFile = null;
      _previewContent = null;
      _previewError = null;
      _imageBytes = null;
      _isImagePreview = false;
      _loadingPreview = false;
    });
  }

  Future<void> _selectFile(GitHubEntry file) async {
    setState(() {
      _selectedFile = file;
      _previewContent = null;
      _previewError = null;
      _imageBytes = null;
      _isImagePreview = _imageExtensions.contains(file.extension);
      _loadingPreview = true;
    });

    try {
      if (_imageExtensions.contains(file.extension)) {
        // 图片：直接下载字节
        if (file.downloadUrl.isNotEmpty) {
          final bytes = await _github.downloadRaw(file.downloadUrl);
          if (mounted) {
            setState(() => _imageBytes = bytes);
          }
        }
      } else if (_textExtensions.contains(file.extension) ||
          _isLikelyText(file.name)) {
        // 文本：通过 Contents API 拿 Base64 内容
        if (file.size <= 1024 * 1024) {
          final content = await _github.getFileContent(file.path);
          final decoded = content.encoding == 'base64'
              ? utf8.decode(
                  base64.decode(content.content.replaceAll('\n', '')),
                  allowMalformed: true,
                )
              : content.content;
          if (mounted) {
            setState(() => _previewContent = decoded);
          }
        } else {
          if (mounted) {
            setState(
              () => _previewContent = '文件过大（>${_formatSize(file.size)}），不支持内联预览。',
            );
          }
        }
      } else {
        if (mounted) {
          setState(() => _previewContent = null); // 显示"不支持预览"占位
        }
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => _previewError = e is StateError ? e.message : e.toString(),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _loadingPreview = false);
      }
    }
  }

  Future<void> _openInBrowser(String url) async {
    if (url.isEmpty) return;
    try {
      if (Platform.isMacOS) {
        await Process.run('open', <String>[url]);
      } else if (Platform.isWindows) {
        await Process.run('cmd', <String>['/c', 'start', '', url]);
      } else {
        await Process.run('xdg-open', <String>[url]);
      }
    } catch (_) {}
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final wide = constraints.maxWidth >= 1100;

        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SizedBox(width: 380, child: _buildBrowserPanel()),
              const SizedBox(width: 12),
              Expanded(child: _buildPreviewPanel()),
            ],
          );
        }

        // 窄屏：上下布局
        return Column(
          children: <Widget>[
            SizedBox(
              height: _selectedFile != null ? 300 : constraints.maxHeight,
              child: _buildBrowserPanel(),
            ),
            if (_selectedFile != null) ...<Widget>[
              const SizedBox(height: 12),
              Expanded(child: _buildPreviewPanel()),
            ],
          ],
        );
      },
    );
  }

  // ── 左侧文件浏览器 ────────────────────────────────────────────────────────────

  Widget _buildBrowserPanel() {
    return AppPanel(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _buildHeader(),
          const Divider(height: 1),
          _buildBreadcrumb(),
          const Divider(height: 1),
          Expanded(child: _buildFileList()),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
      child: Row(
        children: <Widget>[
          const Icon(CupertinoIcons.folder, size: 20, color: Color(0xFF2563EB)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '$_kOwner / $_kRepo',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  '共享文件仓库',
                  style: TextStyle(color: Color(0xFF6B7280), fontSize: 12),
                ),
              ],
            ),
          ),
          // 在浏览器打开仓库主页
          Tooltip(
            message: '在浏览器中打开',
            child: IconButton(
              icon: const Icon(CupertinoIcons.globe, size: 18),
              onPressed: () => _openInBrowser(
                'https://github.com/$_kOwner/$_kRepo',
              ),
            ),
          ),
          // 刷新
          Tooltip(
            message: '刷新',
            child: IconButton(
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(CupertinoIcons.refresh, size: 18),
              onPressed: _loading ? null : _loadCurrentPath,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBreadcrumb() {
    // 面包屑：根 → 路径各段
    final crumbs = <({String label, int index})>[
      (label: _kRepo, index: 0),
      for (int i = 1; i < _pathStack.length; i++)
        (
          label: _pathStack[i].split('/').last,
          index: i,
        ),
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < crumbs.length; i++) ...<Widget>[
            if (i > 0)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 4),
                child: Icon(
                  CupertinoIcons.chevron_right,
                  size: 12,
                  color: Color(0xFF9CA3AF),
                ),
              ),
            GestureDetector(
              onTap: i == crumbs.length - 1
                  ? null
                  : () => _navigateTo(crumbs[i].index),
              child: Text(
                crumbs[i].label,
                style: TextStyle(
                  color: i == crumbs.length - 1
                      ? const Color(0xFF111827)
                      : const Color(0xFF2563EB),
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  decoration: i < crumbs.length - 1
                      ? TextDecoration.underline
                      : null,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildFileList() {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(strokeWidth: 2.5),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(
                CupertinoIcons.exclamationmark_circle,
                size: 36,
                color: Color(0xFFDC2626),
              ),
              const SizedBox(height: 12),
              Text(
                '加载失败',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF6B7280),
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _loadCurrentPath,
                icon: const Icon(CupertinoIcons.refresh),
                label: const Text('重试'),
              ),
            ],
          ),
        ),
      );
    }

    if (_entries.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(
                CupertinoIcons.folder_open,
                size: 48,
                color: Color(0xFF9CA3AF),
              ),
              const SizedBox(height: 12),
              Text(
                _atRoot ? '仓库目前是空的' : '这个目录是空的',
                style: const TextStyle(
                  color: Color(0xFF6B7280),
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (_atRoot) ...<Widget>[
                const SizedBox(height: 8),
                Text(
                  '向 $_kOwner/$_kRepo 推送文件后，这里会自动显示。',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF9CA3AF),
                    fontSize: 13,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: () => _openInBrowser(
                    'https://github.com/$_kOwner/$_kRepo',
                  ),
                  icon: const Icon(CupertinoIcons.globe, size: 16),
                  label: const Text('在 GitHub 上打开'),
                ),
              ],
            ],
          ),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      itemCount: _entries.length,
      separatorBuilder: (_, __) => const SizedBox(height: 4),
      itemBuilder: (BuildContext context, int index) {
        final entry = _entries[index];
        final isSelected =
            _selectedFile?.sha == entry.sha && entry.isFile;

        return Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () {
              if (entry.isDir) {
                _navigateInto(entry);
              } else {
                _selectFile(entry);
              }
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 140),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: isSelected
                    ? const Color(0xFFE8EEF9)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: isSelected
                      ? const Color(0x332563EB)
                      : Colors.transparent,
                ),
              ),
              child: Row(
                children: <Widget>[
                  _EntryIcon(entry: entry),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          entry.name,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF111827),
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (entry.isFile && entry.size > 0)
                          Text(
                            _formatSize(entry.size),
                            style: const TextStyle(
                              color: Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (entry.isDir)
                    const Icon(
                      CupertinoIcons.chevron_right,
                      size: 14,
                      color: Color(0xFF9CA3AF),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // ── 右侧预览面板 ──────────────────────────────────────────────────────────────

  Widget _buildPreviewPanel() {
    return AppPanel(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _buildPreviewHeader(),
          const Divider(height: 1),
          Expanded(child: _buildPreviewBody()),
        ],
      ),
    );
  }

  Widget _buildPreviewHeader() {
    final file = _selectedFile;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
      child: Row(
        children: <Widget>[
          if (file != null) ...<Widget>[
            _EntryIcon(entry: file, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    file.name,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    file.path,
                    style: const TextStyle(
                      color: Color(0xFF6B7280),
                      fontSize: 12,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (file.htmlUrl.isNotEmpty)
              Tooltip(
                message: '在 GitHub 上查看',
                child: IconButton(
                  icon: const Icon(CupertinoIcons.globe, size: 18),
                  onPressed: () => _openInBrowser(file.htmlUrl),
                ),
              ),
            if (file.downloadUrl.isNotEmpty)
              Tooltip(
                message: '下载文件',
                child: IconButton(
                  icon: const Icon(CupertinoIcons.arrow_down_circle, size: 18),
                  onPressed: () => _openInBrowser(file.downloadUrl),
                ),
              ),
          ] else ...<Widget>[
            const Icon(
              CupertinoIcons.doc_text,
              size: 18,
              color: Color(0xFF9CA3AF),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                '文件预览',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPreviewBody() {
    final file = _selectedFile;

    if (file == null) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              CupertinoIcons.doc_text,
              size: 48,
              color: Color(0xFFD1D5DB),
            ),
            SizedBox(height: 12),
            Text(
              '从左侧选择一个文件来预览',
              style: TextStyle(
                color: Color(0xFF9CA3AF),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      );
    }

    if (_loadingPreview) {
      return const Center(
        child: CircularProgressIndicator(strokeWidth: 2.5),
      );
    }

    if (_previewError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(
                CupertinoIcons.exclamationmark_circle,
                size: 36,
                color: Color(0xFFDC2626),
              ),
              const SizedBox(height: 12),
              Text(
                '预览失败',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _previewError!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF6B7280),
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 16),
              if (file.htmlUrl.isNotEmpty)
                OutlinedButton.icon(
                  onPressed: () => _openInBrowser(file.htmlUrl),
                  icon: const Icon(CupertinoIcons.globe, size: 16),
                  label: const Text('在 GitHub 上打开'),
                ),
            ],
          ),
        ),
      );
    }

    // 图片预览
    if (_isImagePreview) {
      if (_imageBytes != null) {
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Image.memory(
              Uint8List.fromList(_imageBytes!),
              fit: BoxFit.contain,
            ),
          ),
        );
      }
      return const Center(
        child: Text(
          '图片加载中…',
          style: TextStyle(color: Color(0xFF6B7280)),
        ),
      );
    }

    // 文本预览
    if (_previewContent != null) {
      final isCode = _codeExtensions.contains(file.extension);
      return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: isCode
                ? const Color(0xFF1E1E2E)
                : const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isCode
                  ? const Color(0xFF3A3A5C)
                  : const Color(0xFFD8DEE7),
            ),
          ),
          child: SelectableText(
            _previewContent!,
            style: TextStyle(
              fontFamily: isCode ? 'monospace' : null,
              fontSize: isCode ? 13 : 14,
              color: isCode
                  ? const Color(0xFFCDD6F4)
                  : const Color(0xFF111827),
              height: 1.6,
            ),
          ),
        ),
      );
    }

    // 不支持预览
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(
              CupertinoIcons.eye_slash,
              size: 48,
              color: Color(0xFFD1D5DB),
            ),
            const SizedBox(height: 12),
            Text(
              '不支持预览 .${file.extension.isEmpty ? '未知格式' : file.extension} 文件',
              style: const TextStyle(
                color: Color(0xFF6B7280),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _formatSize(file.size),
              style: const TextStyle(
                color: Color(0xFF9CA3AF),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 16),
            if (file.downloadUrl.isNotEmpty)
              FilledButton.icon(
                onPressed: () => _openInBrowser(file.downloadUrl),
                icon: const Icon(CupertinoIcons.arrow_down_circle),
                label: const Text('下载文件'),
              ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助 Widgets
// ─────────────────────────────────────────────────────────────────────────────

class _EntryIcon extends StatelessWidget {
  const _EntryIcon({required this.entry, this.size = 20});

  final GitHubEntry entry;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (entry.isDir) {
      return Icon(
        CupertinoIcons.folder_fill,
        size: size,
        color: const Color(0xFFF59E0B),
      );
    }
    final ext = entry.extension;
    final IconData icon;
    final Color color;

    if (_imageExtensions.contains(ext)) {
      icon = CupertinoIcons.photo;
      color = const Color(0xFF10B981);
    } else if (_codeExtensions.contains(ext)) {
      icon = CupertinoIcons.chevron_left_slash_chevron_right;
      color = const Color(0xFF8B5CF6);
    } else if (ext == 'pdf') {
      icon = CupertinoIcons.doc_richtext;
      color = const Color(0xFFDC2626);
    } else if (const <String>{'md', 'txt', 'rst', 'log'}.contains(ext)) {
      icon = CupertinoIcons.doc_text;
      color = const Color(0xFF2563EB);
    } else {
      icon = CupertinoIcons.doc;
      color = const Color(0xFF6B7280);
    }

    return Icon(icon, size: size, color: color);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 常量与工具函数
// ─────────────────────────────────────────────────────────────────────────────

const Set<String> _imageExtensions = <String>{
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
};

const Set<String> _codeExtensions = <String>{
  'dart', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'kt', 'swift',
  'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'sh',
  'bash', 'zsh', 'fish', 'ps1', 'yaml', 'yml', 'json', 'xml',
  'html', 'css', 'scss', 'sql', 'toml', 'ini', 'env', 'dockerfile',
};

const Set<String> _textExtensions = <String>{
  'md', 'txt', 'rst', 'log', 'csv', 'tsv', 'gitignore', 'gitattributes',
  'editorconfig', 'license', 'readme', 'makefile', 'cmake',
  ..._codeExtensions,
};

bool _isLikelyText(String name) {
  // 无扩展名的文件，很多是文本（Makefile, LICENSE, README 等）
  return !name.contains('.') ||
      const <String>{
        'makefile', 'dockerfile', 'license', 'readme', 'changelog',
      }.contains(name.toLowerCase());
}

String _formatSize(int bytes) {
  if (bytes < 1024) return '${bytes} B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}
