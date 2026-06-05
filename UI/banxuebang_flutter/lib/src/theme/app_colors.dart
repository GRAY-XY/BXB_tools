import 'package:flutter/material.dart';

@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.shellBackground,
    required this.panelFill,
    required this.panelFillFrosted,
    required this.panelFillOpaque,
    required this.panelBorder,
    required this.subtleSurface,
    required this.controlFill,
    required this.accentSurface,
    required this.accentForeground,
    required this.mutedText,
    required this.strongText,
    required this.danger,
    required this.navSelected,
    required this.shadowLight,
    required this.shadowDark,
    required this.bannerSuccessBg,
    required this.bannerSuccessBorder,
    required this.bannerSuccessText,
    required this.bannerErrorBg,
    required this.bannerErrorBorder,
    required this.bannerErrorText,
  });

  final Color shellBackground;
  final Color panelFill;
  final double panelFillFrosted;
  final double panelFillOpaque;
  final Color panelBorder;
  final Color subtleSurface;
  final Color controlFill;
  final Color accentSurface;
  final Color accentForeground;
  final Color mutedText;
  final Color strongText;
  final Color danger;
  final Color navSelected;
  final Color shadowLight;
  final Color shadowDark;
  final Color bannerSuccessBg;
  final Color bannerSuccessBorder;
  final Color bannerSuccessText;
  final Color bannerErrorBg;
  final Color bannerErrorBorder;
  final Color bannerErrorText;

  static const AppColors light = AppColors(
    shellBackground: Color(0xFFF1F1EE),
    panelFill: Colors.white,
    panelFillFrosted: 0.72,
    panelFillOpaque: 0.86,
    panelBorder: Color(0x161D1D1F),
    subtleSurface: Color(0x8AFFFFFF),
    controlFill: Color(0x94FFFFFF),
    accentSurface: Color(0xFFE8EEF9),
    accentForeground: Color(0xFF1D4ED8),
    mutedText: Color(0xFF6B7280),
    strongText: Color(0xFF111827),
    danger: Color(0xFFBE123C),
    navSelected: Color(0xFFE7EEFF),
    shadowLight: Color(0x08000000),
    shadowDark: Color(0x12000000),
    bannerSuccessBg: Color(0xFFF0FDFA),
    bannerSuccessBorder: Color(0xFFBBF7D0),
    bannerSuccessText: Color(0xFF0F766E),
    bannerErrorBg: Color(0xFFFFF4EF),
    bannerErrorBorder: Color(0xFFF2C6B3),
    bannerErrorText: Color(0xFF9A3412),
  );

  static const AppColors dark = AppColors(
    shellBackground: Color(0xFF0F1115),
    panelFill: Color(0xFF1A1D24),
    panelFillFrosted: 0.78,
    panelFillOpaque: 0.92,
    panelBorder: Color(0x332A3140),
    subtleSurface: Color(0x332A3140),
    controlFill: Color(0x402A3140),
    accentSurface: Color(0xFF1E2A44),
    accentForeground: Color(0xFF93B4FF),
    mutedText: Color(0xFF9CA3AF),
    strongText: Color(0xFFF3F4F6),
    danger: Color(0xFFF87171),
    navSelected: Color(0xFF243B63),
    shadowLight: Color(0x66000000),
    shadowDark: Color(0x99000000),
    bannerSuccessBg: Color(0xFF102A24),
    bannerSuccessBorder: Color(0xFF1F4D3D),
    bannerSuccessText: Color(0xFF6EE7B7),
    bannerErrorBg: Color(0xFF2A1712),
    bannerErrorBorder: Color(0xFF5C2D22),
    bannerErrorText: Color(0xFFFDBA74),
  );

  @override
  AppColors copyWith({
    Color? shellBackground,
    Color? panelFill,
    double? panelFillFrosted,
    double? panelFillOpaque,
    Color? panelBorder,
    Color? subtleSurface,
    Color? controlFill,
    Color? accentSurface,
    Color? accentForeground,
    Color? mutedText,
    Color? strongText,
    Color? danger,
    Color? navSelected,
    Color? shadowLight,
    Color? shadowDark,
    Color? bannerSuccessBg,
    Color? bannerSuccessBorder,
    Color? bannerSuccessText,
    Color? bannerErrorBg,
    Color? bannerErrorBorder,
    Color? bannerErrorText,
  }) {
    return AppColors(
      shellBackground: shellBackground ?? this.shellBackground,
      panelFill: panelFill ?? this.panelFill,
      panelFillFrosted: panelFillFrosted ?? this.panelFillFrosted,
      panelFillOpaque: panelFillOpaque ?? this.panelFillOpaque,
      panelBorder: panelBorder ?? this.panelBorder,
      subtleSurface: subtleSurface ?? this.subtleSurface,
      controlFill: controlFill ?? this.controlFill,
      accentSurface: accentSurface ?? this.accentSurface,
      accentForeground: accentForeground ?? this.accentForeground,
      mutedText: mutedText ?? this.mutedText,
      strongText: strongText ?? this.strongText,
      danger: danger ?? this.danger,
      navSelected: navSelected ?? this.navSelected,
      shadowLight: shadowLight ?? this.shadowLight,
      shadowDark: shadowDark ?? this.shadowDark,
      bannerSuccessBg: bannerSuccessBg ?? this.bannerSuccessBg,
      bannerSuccessBorder: bannerSuccessBorder ?? this.bannerSuccessBorder,
      bannerSuccessText: bannerSuccessText ?? this.bannerSuccessText,
      bannerErrorBg: bannerErrorBg ?? this.bannerErrorBg,
      bannerErrorBorder: bannerErrorBorder ?? this.bannerErrorBorder,
      bannerErrorText: bannerErrorText ?? this.bannerErrorText,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) {
      return this;
    }
    return AppColors(
      shellBackground: Color.lerp(shellBackground, other.shellBackground, t)!,
      panelFill: Color.lerp(panelFill, other.panelFill, t)!,
      panelFillFrosted: panelFillFrosted + (other.panelFillFrosted - panelFillFrosted) * t,
      panelFillOpaque: panelFillOpaque + (other.panelFillOpaque - panelFillOpaque) * t,
      panelBorder: Color.lerp(panelBorder, other.panelBorder, t)!,
      subtleSurface: Color.lerp(subtleSurface, other.subtleSurface, t)!,
      controlFill: Color.lerp(controlFill, other.controlFill, t)!,
      accentSurface: Color.lerp(accentSurface, other.accentSurface, t)!,
      accentForeground: Color.lerp(accentForeground, other.accentForeground, t)!,
      mutedText: Color.lerp(mutedText, other.mutedText, t)!,
      strongText: Color.lerp(strongText, other.strongText, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      navSelected: Color.lerp(navSelected, other.navSelected, t)!,
      shadowLight: Color.lerp(shadowLight, other.shadowLight, t)!,
      shadowDark: Color.lerp(shadowDark, other.shadowDark, t)!,
      bannerSuccessBg: Color.lerp(bannerSuccessBg, other.bannerSuccessBg, t)!,
      bannerSuccessBorder:
          Color.lerp(bannerSuccessBorder, other.bannerSuccessBorder, t)!,
      bannerSuccessText:
          Color.lerp(bannerSuccessText, other.bannerSuccessText, t)!,
      bannerErrorBg: Color.lerp(bannerErrorBg, other.bannerErrorBg, t)!,
      bannerErrorBorder: Color.lerp(bannerErrorBorder, other.bannerErrorBorder, t)!,
      bannerErrorText: Color.lerp(bannerErrorText, other.bannerErrorText, t)!,
    );
  }

  static AppColors of(BuildContext context) {
    final colors = Theme.of(context).extension<AppColors>();
    if (colors != null) {
      return colors;
    }
    return Theme.of(context).brightness == Brightness.dark
        ? AppColors.dark
        : AppColors.light;
  }
}
