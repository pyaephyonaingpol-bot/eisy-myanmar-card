import 'package:flutter/material.dart';
import 'package:eisy_user_app/services/auth_service.dart';
import 'package:eisy_user_app/screens/pin_unlock_screen.dart';
import 'package:eisy_user_app/screens/home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailCtrl = TextEditingController(text: 'demo@eisy.myanmar');
  final _otpCtrl = TextEditingController();
  bool _otpSent = false;
  bool _loading = false;
  String? _error;
  bool _isRegister = false;
  final _nameCtrl = TextEditingController();
  final _pinCtrl = TextEditingController();

  String? _devOtpBanner;

  Future<void> _sendOtp() async {
    setState(() { _loading = true; _error = null; _devOtpBanner = null; });
    try {
      final Map<String, dynamic> data;
      if (_isRegister) {
        data = await AuthService.instance.sendRegisterOtp(_emailCtrl.text.trim());
      } else {
        data = await AuthService.instance.sendLoginOtp(_emailCtrl.text.trim());
      }
      final devOtp = data['dev_otp']?.toString();
      if (devOtp != null && devOtp.length == 6) {
        _otpCtrl.text = devOtp;
        _devOtpBanner = devOtp;
      }
      setState(() => _otpSent = true);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(devOtp != null
                ? 'Dev OTP: $devOtp (auto-filled)'
                : 'OTP sent — check server console'),
            duration: const Duration(seconds: 8),
          ),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    setState(() { _loading = true; _error = null; });
    try {
      if (_isRegister) {
        await AuthService.instance.completeRegister(
          email: _emailCtrl.text.trim(),
          otp: _otpCtrl.text.trim(),
          name: _nameCtrl.text.trim(),
          pin: _pinCtrl.text.trim(),
        );
      } else {
        await AuthService.instance.verifyLoginOtp(_emailCtrl.text.trim(), _otpCtrl.text.trim());
      }
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const PinUnlockScreen(next: HomeScreen())),
      );
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Eisy Myanmar')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(_isRegister ? 'Create Account' : 'Login with Email OTP',
              style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 24),
          if (_isRegister)
            TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder())),
          if (_isRegister) const SizedBox(height: 12),
          TextField(
            controller: _emailCtrl,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
          ),
          if (_isRegister) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _pinCtrl,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(labelText: '6-digit PIN', border: OutlineInputBorder()),
            ),
          ],
          const SizedBox(height: 12),
          if (_devOtpBanner != null) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.green.shade900,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.green),
              ),
              child: Column(
                children: [
                  const Text('DEV OTP', style: TextStyle(color: Colors.greenAccent, fontSize: 12)),
                  Text(
                    _devOtpBanner!,
                    style: const TextStyle(fontSize: 32, letterSpacing: 8, fontWeight: FontWeight.bold),
                  ),
                  const Text('Auto-filled for testing', style: TextStyle(fontSize: 12, color: Colors.white70)),
                ],
              ),
            ),
          ],
          if (_otpSent)
            TextField(
              controller: _otpCtrl,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(labelText: 'Email OTP', border: OutlineInputBorder()),
            ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _loading ? null : (_otpSent ? _submit : _sendOtp),
            child: _loading
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(_otpSent ? (_isRegister ? 'Create Account' : 'Verify & Login') : 'Send OTP'),
          ),
          TextButton(
            onPressed: () => setState(() { _isRegister = !_isRegister; _otpSent = false; }),
            child: Text(_isRegister ? 'Already have an account? Login' : 'Need an account? Register'),
          ),
        ],
      ),
    );
  }
}
