import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../state/app_controller.dart';
import '../state/theme_controller.dart';
import '../theme/app_colors.dart';
import '../theme/app_theme.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({
    super.key,
    required this.themeController,
    required this.controller,
  });

  final ThemeController themeController;
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);

    return AppPanel(
      child: ListenableBuilder(
        listenable: controller,
        builder: (BuildContext context, Widget? child) {
          return ListView(
            children: <Widget>[
              Text(
                '设置',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '调整外观与显示偏好。',
                style: TextStyle(color: colors.mutedText, height: 1.35),
              ),
              const SizedBox(height: 24),

              // ── 外观 ────────────────────────────────────────────────
              _SectionHeader(title: '外观模式'),
              const SizedBox(height: 8),
              Text(
                '可选择浅色、深色，或跟随系统外观自动切换。',
                style: TextStyle(color: colors.mutedText, height: 1.35),
              ),
              const SizedBox(height: 16),
              AnimatedBuilder(
                animation: themeController,
                builder: (BuildContext context, Widget? child) {
                  return SegmentedButton<AppThemePreference>(
                    segments: const <ButtonSegment<AppThemePreference>>[
                      ButtonSegment(
                        value: AppThemePreference.system,
                        label: Text('跟随系统'),
                        icon: Icon(CupertinoIcons.circle_lefthalf_fill),
                      ),
                      ButtonSegment(
                        value: AppThemePreference.light,
                        label: Text('浅色'),
                        icon: Icon(CupertinoIcons.sun_max),
                      ),
                      ButtonSegment(
                        value: AppThemePreference.dark,
                        label: Text('深色'),
                        icon: Icon(CupertinoIcons.moon),
                      ),
                    ],
                    selected: <AppThemePreference>{themeController.preference},
                    onSelectionChanged: (Set<AppThemePreference> selected) {
                      if (selected.isEmpty) return;
                      themeController.setPreference(selected.first);
                    },
                  );
                },
              ),
              const SizedBox(height: 20),
              _ThemePreviewCard(preference: themeController.preference),

              const SizedBox(height: 32),
              const Divider(),
              const SizedBox(height: 24),

              // ── 更新 ────────────────────────────────────────────────
              _SectionHeader(title: '检查更新'),
              const SizedBox(height: 8),
              Text(
                '从 GitHub Releases 获取最新版本信息。',
                style: TextStyle(color: colors.mutedText, height: 1.35),
              ),
              const SizedBox(height: 16),
              _UpdateCard(controller: controller, colors: colors),

              const SizedBox(height: 32),
              const Divider(),
              const SizedBox(height: 24),

              // ── 卸载 ────────────────────────────────────────────────
              _SectionHeader(title: '卸载应用'),
              const SizedBox(height: 8),
              Text(
                '清除本地应用数据（会话、缓存、日志）。操作不可撤销，数据清除后需要重新登录。',
                style: TextStyle(color: colors.mutedText, height: 1.35),
              ),
              const SizedBox(height: 16),
              _UninstallCard(controller: controller),

              const SizedBox(height: 32),
            ],
          );
        },
      ),
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 更新卡片
// ────────────────────────────────────────────────────────────────────────────

class _UpdateCard extends StatelessWidget {
  const _UpdateCard({required this.controller, required this.colors});

  final AppController controller;
  final AppColors colors;

  @override
  Widget build(BuildContext context) {
    final info = controller.updateInfo;
    final checking = controller.checkingUpdates;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.subtleSurface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.panelBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (info != null) ...<Widget>[
            _UpdateInfoRow(info: info, colors: colors, controller: controller),
            const SizedBox(height: 14),
          ],
          FilledButton.tonalIcon(
            onPressed: checking ? null : controller.checkForUpdates,
            icon: checking
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(CupertinoIcons.arrow_clockwise),
            label: Text(checking ? '检查中…' : '检查更新'),
          ),
        ],
      ),
    );
  }
}

class _UpdateInfoRow extends StatelessWidget {
  const _UpdateInfoRow({
    required this.info,
    required this.colors,
    required this.controller,
  });

  final Map<String, dynamic> info;
  final AppColors colors;
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final current = info['currentVersion']?.toString() ?? '--';
    final latest = info['latestVersion']?.toString() ?? '--';
    final hasUpdate = info['hasUpdate'] == true;
    final releaseUrl = info['releaseUrl']?.toString() ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            const Icon(CupertinoIcons.info_circle, size: 16),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                hasUpdate
                    ? '发现新版本 v$latest'
                    : '当前已是最新版本 v$current',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: hasUpdate
                      ? const Color(0xFFB45309)
                      : colors.strongText,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          '当前版本 v$current${hasUpdate ? "，最新 v$latest" : ""}',
          style: TextStyle(color: colors.mutedText, fontSize: 13),
        ),
        if (hasUpdate && releaseUrl.isNotEmpty) ...<Widget>[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => controller.openReleaseUrl(releaseUrl),
            icon: const Icon(CupertinoIcons.arrow_up_right_square, size: 15),
            label: const Text('前往下载页'),
          ),
        ],
      ],
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 卸载卡片
// ────────────────────────────────────────────────────────────────────────────

class _UninstallCard extends StatelessWidget {
  const _UninstallCard({required this.controller});

  final AppController controller;

  Future<void> _confirmAndUninstall(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('确认卸载'),
        content: const Text(
          '这将删除本地所有应用数据（会话文件、日志、缓存）。\n\n操作完成后需要手动将应用程序移到废纸篓。\n\n此操作不可撤销，确定要继续吗？',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFDC2626),
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('确认卸载'),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;

    final ok = await controller.uninstallApp();
    if (!context.mounted) return;

    if (ok) {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('数据已清除'),
          content: const Text(
            '本地应用数据已删除。请将应用程序移到废纸篓以完成卸载。',
          ),
          actions: <Widget>[
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('好的'),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: const Color(0xFFDC2626),
        foregroundColor: Colors.white,
      ),
      onPressed: controller.uninstalling
          ? null
          : () => _confirmAndUninstall(context),
      icon: controller.uninstalling
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          : const Icon(CupertinoIcons.trash),
      label: Text(controller.uninstalling ? '卸载中…' : '卸载应用'),
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 通用小组件
// ────────────────────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: Theme.of(context).textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w800,
      ),
    );
  }
}

class _ThemePreviewCard extends StatelessWidget {
  const _ThemePreviewCard({required this.preference});

  final AppThemePreference preference;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final label = switch (preference) {
      AppThemePreference.system => '当前：跟随系统',
      AppThemePreference.light => '当前：浅色模式',
      AppThemePreference.dark => '当前：深色模式',
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.subtleSurface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.panelBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: TextStyle(
              color: colors.strongText,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '侧栏、面板、表单和通知条会随主题一起切换。',
            style: TextStyle(color: colors.mutedText, height: 1.35),
          ),
        ],
      ),
    );
  }
}
