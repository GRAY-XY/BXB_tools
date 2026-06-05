import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum AppThemePreference { system, light, dark }

class ThemeController extends ChangeNotifier {
  static const String _storageKey = 'app_theme_preference';

  AppThemePreference preference = AppThemePreference.system;
  bool ready = false;

  ThemeMode get themeMode => switch (preference) {
    AppThemePreference.system => ThemeMode.system,
    AppThemePreference.light => ThemeMode.light,
    AppThemePreference.dark => ThemeMode.dark,
  };

  Future<void> initialize() async {
    final prefs = await SharedPreferences.getInstance();
    preference = _decode(prefs.getString(_storageKey));
    ready = true;
    notifyListeners();
  }

  Future<void> setPreference(AppThemePreference value) async {
    if (preference == value) {
      return;
    }
    preference = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, _encode(value));
  }

  static AppThemePreference _decode(String? raw) {
    return switch (raw) {
      'light' => AppThemePreference.light,
      'dark' => AppThemePreference.dark,
      _ => AppThemePreference.system,
    };
  }

  static String _encode(AppThemePreference value) {
    return switch (value) {
      AppThemePreference.light => 'light',
      AppThemePreference.dark => 'dark',
      AppThemePreference.system => 'system',
    };
  }
}
