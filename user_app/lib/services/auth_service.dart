import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:eisy_user_app/config/app_config.dart';
import 'package:eisy_user_app/services/auth_storage.dart';

class AuthService {
  static final AuthService instance = AuthService._();
  AuthService._();

  String get _base => AppConfig.baseUrl;

  Future<Map<String, String>> _headers({bool sensitive = false}) async {
    final auth = await AuthStorage.load();
    final headers = {'Content-Type': 'application/json'};
    if (auth?['sessionToken'] != null) {
      headers['Authorization'] = 'Bearer ${auth!['sessionToken']}';
    }
    if (sensitive && auth?['pinToken'] != null) {
      headers['X-Pin-Token'] = auth!['pinToken'] as String;
    }
    if (sensitive) {
      final bio = await AuthStorage.getBiometricToken();
      if (bio != null) headers['X-Biometric-Token'] = bio;
    }
    return headers;
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool sensitive = false,
  }) async {
    final uri = Uri.parse('$_base$path');
    final headers = await _headers(sensitive: sensitive);
    final res = await http.Request(method, uri)
      ..headers.addAll(headers)
      ..body = body != null ? jsonEncode(body) : '';

    final streamed = await http.Client().send(res);
    final response = await http.Response.fromStream(streamed);
    final data = jsonDecode(response.body) as Map<String, dynamic>? ?? {};

    if (response.statusCode >= 400) {
      throw AuthException(data['error']?.toString() ?? 'Request failed', data['code']?.toString());
    }
    return data;
  }

  Future<Map<String, dynamic>> sendLoginOtp(String email) async {
    return _request('POST', '/api/auth/login/send-otp', body: {'email': email});
  }

  Future<Map<String, dynamic>> verifyLoginOtp(String email, String otp) async {
    final data = await _request('POST', '/api/auth/login/verify', body: {'email': email, 'otp': otp});
    await AuthStorage.save(
      sessionToken: data['sessionToken'] as String,
      user: data['user'] as Map<String, dynamic>,
    );
    return data;
  }

  Future<Map<String, dynamic>> sendRegisterOtp(String email) async {
    return _request('POST', '/api/auth/register/send-otp', body: {'email': email});
  }

  Future<Map<String, dynamic>> completeRegister({
    required String email,
    required String otp,
    required String name,
    required String pin,
    String? phone,
  }) async {
    final data = await _request('POST', '/api/auth/register/complete', body: {
      'email': email,
      'otp': otp,
      'name': name,
      'pin': pin,
      'phone': phone,
    });
    await AuthStorage.save(
      sessionToken: data['sessionToken'] as String,
      user: data['user'] as Map<String, dynamic>,
      pinToken: data['pin_token'] as String?,
    );
    return data;
  }

  Future<String> verifyPin(String pin) async {
    final data = await _request('POST', '/api/auth/pin/verify', body: {'pin': pin});
    final pinToken = data['pin_token'] as String;
    await AuthStorage.setPinToken(pinToken);
    return pinToken;
  }

  Future<void> registerBiometrics() async {
    var token = await AuthStorage.getBiometricToken();
    token ??= _generateToken();
    await AuthStorage.setBiometricToken(token);
    await _request('POST', '/api/auth/biometrics/register', body: {
      'device_token': token,
      'device_name': 'Flutter App',
    });
  }

  Future<void> logout() async {
    try {
      await _request('POST', '/api/auth/logout', body: {});
    } catch (_) {}
    await AuthStorage.clear();
  }

  Future<bool> isLoggedIn() async {
    final auth = await AuthStorage.load();
    return auth?['sessionToken'] != null;
  }

  String _generateToken() {
    final rnd = Random.secure();
    return List.generate(32, (_) => rnd.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
}

class AuthException implements Exception {
  final String message;
  final String? code;
  AuthException(this.message, [this.code]);
  @override
  String toString() => message;
}
