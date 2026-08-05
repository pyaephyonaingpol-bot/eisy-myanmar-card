import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:eisy_user_app/config/app_config.dart';
import 'package:eisy_user_app/services/auth_storage.dart';

class ApiService {
  static final ApiService instance = ApiService._();
  ApiService._();

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

  Future<Map<String, dynamic>> getWallet({bool sensitive = true}) async {
    final res = await http.get(
      Uri.parse('$_base/api/user/wallet'),
      headers: await _headers(sensitive: sensitive),
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(body['error'] ?? 'Failed to load wallet');
    }
    return body;
  }

  Future<Map<String, dynamic>> getCards({bool sensitive = true}) async {
    final res = await http.get(
      Uri.parse('$_base/api/user/cards'),
      headers: await _headers(sensitive: sensitive),
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(body['error'] ?? 'Failed to load cards');
    }
    return body;
  }

  Future<Map<String, dynamic>> getCard({bool sensitive = true}) async {
    final res = await http.get(
      Uri.parse('$_base/api/user/card'),
      headers: await _headers(sensitive: sensitive),
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(body['error'] ?? 'Failed to load card');
    }
    return body;
  }

  Future<Map<String, dynamic>> requestDeposit({
    required double amountMmk,
    required String paymentMethod,
  }) async {
    final res = await http.post(
      Uri.parse('$_base/api/deposit/request'),
      headers: await _headers(sensitive: true),
      body: jsonEncode({
        'amount_mmk': amountMmk,
        'payment_method': paymentMethod,
      }),
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(body['error'] ?? 'Deposit request failed');
    }
    return body;
  }

  Future<Map<String, dynamic>> getDepositStatus(String refCode) async {
    final res = await http.get(
      Uri.parse('$_base/api/deposit/status/$refCode'),
      headers: await _headers(sensitive: false),
    );
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(body['error'] ?? 'Status check failed');
    }
    return body;
  }
}
