import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class AuthStorage {
  static const _key = 'eisy_auth';
  static const _bioKey = 'eisy_bio_token';

  static Future<Map<String, dynamic>?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  static Future<void> save({
    required String sessionToken,
    required Map<String, dynamic> user,
    String? pinToken,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final existing = await load() ?? {};
    existing['sessionToken'] = sessionToken;
    existing['user'] = user;
    if (pinToken != null) existing['pinToken'] = pinToken;
    await prefs.setString(_key, jsonEncode(existing));
  }

  static Future<void> setPinToken(String pinToken) async {
    final data = await load() ?? {};
    data['pinToken'] = pinToken;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(data));
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }

  static Future<String?> getBiometricToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_bioKey);
  }

  static Future<void> setBiometricToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_bioKey, token);
  }
}
