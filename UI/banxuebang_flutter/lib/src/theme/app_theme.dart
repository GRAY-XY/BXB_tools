import 'dart:ui';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

ThemeData buildAppTheme() {
  const seed = Color(0xFF2563EB);
  final scheme =
      ColorScheme.fromSeed(
        seedColor: seed,
        brightness: Brightness.light,
        surface: const Color(0xFFF5F5F3),
      ).copyWith(
        surface: const Color(0xFFF6F6F4),
        surfaceContainerHighest: const Color(0xFFFDFDFC),
        outlineVariant: const Color(0x1F1D1D1F),
        primaryContainer: const Color(0xFFE6EEFF),
        secondaryContainer: const Color(0xFFEAF7F1),
      );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFFF1F1EE),
    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    textTheme: ThemeData(useMaterial3: true).textTheme.apply(
      bodyColor: const Color(0xFF1D1D1F),
      displayColor: const Color(0xFF111827),
    ),
    iconTheme: const IconThemeData(color: Color(0xFF4B5563)),
    dividerColor: const Color(0x1A1D1D1F),
    dividerTheme: const DividerThemeData(
      color: Color(0x1A1D1D1F),
      thickness: 1,
      space: 1,
    ),
    splashColor: seed.withValues(alpha: 0.08),
    highlightColor: Colors.transparent,
    hoverColor: const Color(0x0D111827),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white.withValues(alpha: 0.78),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: Color(0x1F1D1D1F)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: Color(0x1F1D1D1F)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: seed.withValues(alpha: 0.55), width: 1.2),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: Color(0x141D1D1F)),
      ),
      labelStyle: const TextStyle(color: Color(0xFF6B7280)),
      hintStyle: const TextStyle(color: Color(0xFF9CA3AF)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 38),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        backgroundColor: const Color(0xFF2563EB),
        foregroundColor: Colors.white,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 38),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        side: const BorderSide(color: Color(0x1F1D1D1F)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        backgroundColor: Colors.white.withValues(alpha: 0.5),
        foregroundColor: const Color(0xFF111827),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    chipTheme: ChipThemeData(
      side: const BorderSide(color: Color(0x141D1D1F)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      backgroundColor: Colors.white.withValues(alpha: 0.62),
      selectedColor: const Color(0xFFE8EEF9),
      labelStyle: const TextStyle(
        fontWeight: FontWeight.w600,
        color: Color(0xFF374151),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        visualDensity: VisualDensity.compact,
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const Color(0xFFE7EEFF);
          }
          return Colors.white.withValues(alpha: 0.62);
        }),
        foregroundColor: WidgetStateProperty.all(const Color(0xFF111827)),
        side: WidgetStateProperty.all(
          const BorderSide(color: Color(0x1A1D1D1F)),
        ),
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
        color: const Color(0xE6111827),
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
        if (states.contains(WidgetState.dragged)) {
          return const Color(0x80717887);
        }
        return const Color(0x5C8B93A1);
      }),
      trackColor: WidgetStateProperty.all(const Color(0x08111827)),
    ),
  );
}

Color colorFromHex(
  String? raw, {
  Color fallback = const Color(0xFF6B7280),
  double opacity = 1,
}) {
  final value = (raw ?? '').trim().replaceFirst('#', '');
  if (value.isEmpty) {
    return fallback.withValues(alpha: opacity);
  }
  final normalized = value.length == 6 ? 'FF$value' : value;
  final parsed = int.tryParse(normalized, radix: 16);
  if (parsed == null) {
    return fallback.withValues(alpha: opacity);
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
    final body = Container(
      decoration: BoxDecoration(
        color: (tint ?? Colors.white).withValues(alpha: frosted ? 0.72 : 0.86),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: borderColor ?? const Color(0x161D1D1F)),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 22,
            offset: Offset(0, 10),
          ),
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 6,
            offset: Offset(0, 1),
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
    final foreground = isError
        ? const Color(0xFF9A3412)
        : const Color(0xFF0F766E);
    final background = isError
        ? const Color(0xFFFFF4EF)
        : const Color(0xFFF0FDFA);
    final border = isError ? const Color(0xFFF2C6B3) : const Color(0xFFBBF7D0);

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
