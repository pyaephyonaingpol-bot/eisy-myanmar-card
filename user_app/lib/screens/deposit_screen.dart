import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:eisy_user_app/services/api_service.dart';

class DepositScreen extends StatefulWidget {
  const DepositScreen({super.key});

  @override
  State<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends State<DepositScreen> {
  final _amountController = TextEditingController();
  String _paymentMethod = 'KBZPay';
  String? _refCode;
  String _status = 'idle';
  String? _error;
  Timer? _pollTimer;

  @override
  void dispose() {
    _pollTimer?.cancel();
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _createDeposit() async {
    final amount = double.tryParse(_amountController.text.replaceAll(',', ''));
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount in MMK');
      return;
    }

    setState(() {
      _error = null;
      _status = 'creating';
    });

    try {
      final result = await ApiService.instance.requestDeposit(
        amountMmk: amount,
        paymentMethod: _paymentMethod,
      );
      final ref = result['deposit']['ref_code'] as String;
      setState(() {
        _refCode = ref;
        _status = 'waiting';
      });
      _startPolling(ref);
    } catch (e) {
      setState(() {
        _error = e.toString();
        _status = 'idle';
      });
    }
  }

  void _startPolling(String refCode) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
      try {
        final result = await ApiService.instance.getDepositStatus(refCode);
        final status = result['deposit']['status'] as String;
        if (status == 'VERIFIED') {
          _pollTimer?.cancel();
          if (mounted) {
            setState(() => _status = 'verified');
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Payment verified! Balance updated.')),
            );
          }
        } else if (status == 'FAILED') {
          _pollTimer?.cancel();
          if (mounted) setState(() => _status = 'failed');
        }
      } catch (_) {}
    });
  }

  Future<void> _copyRefCode() async {
    if (_refCode == null) return;
    await Clipboard.setData(ClipboardData(text: _refCode!));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Reference code copied')),
      );
    }
  }

  Future<void> _openKPay() async {
    final uri = Uri.parse('kpay://');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('KBZPay app not installed')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Deposit Funds')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _amountController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Amount (MMK)',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.payments),
            ),
            enabled: _status == 'idle' || _status == 'creating',
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _paymentMethod,
            decoration: const InputDecoration(
              labelText: 'Payment Method',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(value: 'KBZPay', child: Text('KBZPay')),
              DropdownMenuItem(value: 'WavePay', child: Text('WavePay')),
            ],
            onChanged: (_status == 'idle')
                ? (v) => setState(() => _paymentMethod = v!)
                : null,
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 24),
          if (_refCode == null)
            FilledButton(
              onPressed: _status == 'creating' ? null : _createDeposit,
              child: _status == 'creating'
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Generate Payment Code'),
            ),
          if (_refCode != null) ...[
            _RefCodeCard(refCode: _refCode!, onCopy: _copyRefCode),
            const SizedBox(height: 16),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Instructions', style: TextStyle(fontWeight: FontWeight.bold)),
                    SizedBox(height: 8),
                    Text('1. Copy the reference code above'),
                    Text('2. Open your payment app and send the exact MMK amount'),
                    Text('3. Include the reference code in the payment note/description'),
                    Text('4. Wait for automatic verification'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (_paymentMethod == 'KBZPay')
              OutlinedButton.icon(
                onPressed: _openKPay,
                icon: const Icon(Icons.open_in_new),
                label: const Text('Pay via KBZPay'),
              ),
            const SizedBox(height: 24),
            _StatusTracker(status: _status),
          ],
        ],
      ),
    );
  }
}

class _RefCodeCard extends StatelessWidget {
  final String refCode;
  final VoidCallback onCopy;

  const _RefCodeCard({required this.refCode, required this.onCopy});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Text(
              'Your Reference Code',
              style: TextStyle(color: Theme.of(context).colorScheme.onPrimaryContainer),
            ),
            const SizedBox(height: 8),
            Text(
              refCode,
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.bold,
                letterSpacing: 2,
                color: Theme.of(context).colorScheme.onPrimaryContainer,
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.tonalIcon(
              onPressed: onCopy,
              icon: const Icon(Icons.copy),
              label: const Text('Copy Code'),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusTracker extends StatelessWidget {
  final String status;

  const _StatusTracker({required this.status});

  @override
  Widget build(BuildContext context) {
    final (icon, text, color) = switch (status) {
      'verified' => (Icons.check_circle, 'Payment Verified!', Colors.green),
      'failed' => (Icons.error, 'Verification Failed', Colors.red),
      _ => (Icons.hourglass_top, 'Waiting for Payment Verification...', Colors.orange),
    };

    return Row(
      children: [
        Icon(icon, color: color),
        const SizedBox(width: 12),
        Expanded(
          child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w500)),
        ),
        if (status == 'waiting')
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
      ],
    );
  }
}
