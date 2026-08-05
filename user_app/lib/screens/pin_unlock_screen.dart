import 'package:flutter/material.dart';
import 'package:eisy_user_app/services/auth_service.dart';

class PinUnlockScreen extends StatefulWidget {
  final Widget next;
  const PinUnlockScreen({super.key, required this.next});

  @override
  State<PinUnlockScreen> createState() => _PinUnlockScreenState();
}

class _PinUnlockScreenState extends State<PinUnlockScreen> {
  final _pinCtrl = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _unlock() async {
    setState(() { _loading = true; _error = null; });
    try {
      await AuthService.instance.verifyPin(_pinCtrl.text.trim());
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => widget.next));
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Security PIN')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.lock_outline, size: 64),
            const SizedBox(height: 16),
            const Text('Enter your 6-digit PIN to access balance and card details.'),
            const SizedBox(height: 24),
            TextField(
              controller: _pinCtrl,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(labelText: 'PIN', border: OutlineInputBorder()),
            ),
            if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _loading ? null : _unlock,
              child: _loading
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Unlock'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () async {
                await AuthService.instance.registerBiometrics();
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Biometrics registered')),
                  );
                }
              },
              child: const Text('Register Biometrics Token'),
            ),
          ],
        ),
      ),
    );
  }
}
