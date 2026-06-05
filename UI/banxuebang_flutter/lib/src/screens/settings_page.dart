import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../state/theme_controller.dart';
import '../theme/app_colors.dart';
import '../theme/app_theme.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.themeController});

  final ThemeController themeController;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);

    return AppPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
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
          Text(
            '外观模式',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
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
                  if (selected.isEmpty) {
                    return;
                  }
                  themeController.setPreference(selected.first);
                },
              );
            },
          ),
          const SizedBox(height: 20),
          _ThemePreviewCard(preference: themeController.preference),
        ],
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
