import 'dart:ui';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'app_colors.dart';

ThemeData buildAppTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final appColors = isDark ? AppColors.dark : AppColors.light;
  const seed = Color(0xFF2563EB);
  final scheme =
      ColorScheme.fromSeed(
        seedColor: seed,
        brightness: brightness,
        surface: isDark ? const Color(0xFF14161C) : const Color(0xFFF5F5F3),
      ).copyWith(
        surface: isDark ? const Color(0xFF14161C) : const Color(0xFFF6F6F4),
        surfaceContainerHighest:
            isDark ? const Color(0xFF1E222A) : const Color(0xFFFDFDFC),
        outlineVariant:
            isDark ? const Color(0x332A3140) : const Color(0x1F1D1D1F),
        primaryContainer:
            isDark ? const Color(0xFF1E2F52) : const Color(0xFFE6EEFF),
        secondaryContainer:
            isDark ? const Color(0xFF173328) : const Color(0xFFEAF7F1),
        onSurface: appColors.strongText,
        onSurfaceVariant: appColors.mutedText,
      );

  final inputFill = isDark
      ? const Color(0xFF232833).withValues(alpha: 0.92)
      : Colors.white.withValues(alpha: 0.78);
  final outlinedBg = isDark
      ? const Color(0xFF232833).withValues(alpha: 0.72)
      : Colors.white.withValues(alpha: 0.5);
  final chipBg = isDark
      ? const Color(0xFF232833).withValues(alpha: 0.88)
      : Colors.white.withValues(alpha: 0.62);
  final segmentedIdle = isDark
      ? const Color(0xFF232833).withValues(alpha: 0.72)
      : Colors.white.withValues(alpha: 0.62);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    extensions: <ThemeExtension<dynamic>>[appColors],
    scaffoldBackgroundColor: appColors.shellBackground,
    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    textTheme: ThemeData(useMaterial3: true, brightness: brightness).textTheme
        .apply(
          bodyColor: appColors.strongText,
          displayColor: appColors.strongText,
        ),
    iconTheme: IconThemeData(color: appColors.mutedText),
    dividerColor: appColors.panelBorder,
    dividerTheme: DividerThemeData(
      color: appColors.panelBorder,
      thickness: 1,
      space: 1,
    ),
    splashColor: seed.withValues(alpha: isDark ? 0.16 : 0.08),
    highlightColor: Colors.transparent,
    hoverColor: appColors.strongText.withValues(alpha: isDark ? 0.06 : 0.05),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: inputFill,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: appColors.panelBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: appColors.panelBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: seed.withValues(alpha: 0.55), width: 1.2),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(
          color: appColors.panelBorder.withValues(alpha: 0.6),
        ),
      ),
      labelStyle: TextStyle(color: appColors.mutedText),
      hintStyle: TextStyle(
        color: appColors.mutedText.withValues(alpha: 0.85),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 38),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        backgroundColor: seed,
        foregroundColor: Colors.white,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 38),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        side: BorderSide(color: appColors.panelBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        backgroundColor: outlinedBg,
        foregroundColor: appColors.strongText,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    chipTheme: ChipThemeData(
      side: BorderSide(color: appColors.panelBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      backgroundColor: chipBg,
      selectedColor: appColors.navSelected,
      labelStyle: TextStyle(
        fontWeight: FontWeight.w600,
        color: appColors.strongText.withValues(alpha: 0.88),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        visualDensity: VisualDensity.compact,
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return appColors.navSelected;
          }
          return segmentedIdle;
        }),
        foregroundColor: WidgetStateProperty.all(appColors.strongText),
        side: WidgetStateProperty.all(BorderSide(color: appColors.panelBorder)),
        padding: WidgetStateProperty.all(
          const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        ),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(
        color: isDark ? const Color(0xE61F2937) : const Color(0xE6111827),
        borderRadius: BorderRadius.circular(8),
      ),
      textStyle: const TextStyle(
        color: Colors.white,
        fontWeight: FontWeight.w600,
      ),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbVisibility: WidgetStateProperty.all(true),
      radius: const Radius.circular(99),
      thickness: WidgetStateProperty.all(6),
      thumbColor: WidgetStateProperty.resolveWith((states) {
        final base = isDark ? const Color(0xFF6B7280) : const Color(0xFF8B93A1);
        if (states.contains(WidgetState.dragged)) {
          return base.withValues(alpha: 0.72);
        }
        return base.withValues(alpha: 0.45);
      }),
      trackColor: WidgetStateProperty.all(
        appColors.strongText.withValues(alpha: isDark ? 0.08 : 0.03),
      ),
    ),
  );
}

Color colorFromHex(
  String? raw, {
  Color? fallback,
  double opacity = 1,
}) {
  final resolvedFallback = fallback ?? const Color(0xFF6B7280);
  final value = (raw ?? '').trim().replaceFirst('#', '');
  if (value.isEmpty) {
    return resolvedFallback.withValues(alpha: opacity);
  }
  final normalized = value.length == 6 ? 'FF$value' : value;
  final parsed = int.tryParse(normalized, radix: 16);
  if (parsed == null) {
    return resolvedFallback.withValues(alpha: opacity);
  }
  return Color(parsed).withValues(alpha: opacity);
}

class AppPanel extends StatelessWidget {
  const AppPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.tint,
    this.borderColor,
    this.frosted = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? tint;
  final Color? borderColor;
  final bool frosted;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final fill = tint ?? colors.panelFill;
    final alpha = frosted ? colors.panelFillFrosted : colors.panelFillOpaque;
    final body = Container(
      decoration: BoxDecoration(
        color: fill.withValues(alpha: alpha),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: borderColor ?? colors.panelBorder),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: colors.shadowLight,
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
          BoxShadow(
            color: colors.shadowDark,
            blurRadius: 6,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      padding: padding,
      child: child,
    );

    if (!frosted) {
      return body;
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: body,
      ),
    );
  }
}

class AppMark extends StatelessWidget {
  const AppMark({super.key, this.size = 36});

  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.asset(
        'assets/images/app_mark.png',
        width: size,
        height: size,
        fit: BoxFit.cover,
      ),
    );
  }
}

class BannerStrip extends StatelessWidget {
  const BannerStrip({
    super.key,
    required this.message,
    required this.isError,
    required this.onClose,
  });

  final String message;
  final bool isError;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final foreground =
        isError ? colors.bannerErrorText : colors.bannerSuccessText;
    final background =
        isError ? colors.bannerErrorBg : colors.bannerSuccessBg;
    final border =
        isError ? colors.bannerErrorBorder : colors.bannerSuccessBorder;

    return Container(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: border),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: <Widget>[
          Icon(
            isError
                ? CupertinoIcons.exclamationmark_circle
                : CupertinoIcons.check_mark_circled_solid,
            color: foreground,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: foreground, fontWeight: FontWeight.w600),
            ),
          ),
          IconButton(
            tooltip: '关闭',
            onPressed: onClose,
            icon: const Icon(CupertinoIcons.xmark),
          ),
        ],
      ),
    );
  }
}
