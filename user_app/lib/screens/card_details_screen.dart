import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:eisy_user_app/widgets/card_preview.dart';

class CardDetailsScreen extends StatefulWidget {
  final Map<String, dynamic> card;

  const CardDetailsScreen({super.key, required this.card});

  @override
  State<CardDetailsScreen> createState() => _CardDetailsScreenState();
}

class _CardDetailsScreenState extends State<CardDetailsScreen> {
  bool _showSensitive = false;

  String get _cardNumber => widget.card['card_number'] as String;
  String get _expDate => widget.card['exp_date'] as String;
  String get _cvv => widget.card['cvv'] as String;
  String get _holder => widget.card['card_holder_name'] as String;

  Future<void> _copyText(String text, {String? label}) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(label ?? 'Copied to clipboard!'),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  String _formatAllDetails() {
    final digits = _cardNumber.replaceAll(' ', '');
    return 'Card Number: ${_formatNumber(digits)}\nExpiry: $_expDate\nCVV: $_cvv';
  }

  String _formatNumber(String digits) {
    final buffer = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && i % 4 == 0) buffer.write(' ');
      buffer.write(digits[i]);
    }
    return buffer.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Virtual Card')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          CardPreview(
            cardNumber: _cardNumber,
            holderName: _holder,
            expDate: _expDate,
            cvv: _cvv,
            masked: !_showSensitive,
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _showSensitive
                ? () => _copyText(_cardNumber.replaceAll(' ', ''))
                : null,
            icon: const Icon(Icons.copy, size: 18),
            label: const Text('Copy Card Number'),
          ),
          const SizedBox(height: 24),
          SwitchListTile(
            title: const Text('Show sensitive info'),
            subtitle: const Text('Reveal full card number, expiry, and CVV'),
            value: _showSensitive,
            onChanged: (v) => setState(() => _showSensitive = v),
          ),
          const SizedBox(height: 8),
          _CopyDetailRow(
            label: 'Card Number',
            value: _showSensitive ? _formatNumber(_cardNumber.replaceAll(' ', '')) : _maskCard(_cardNumber),
            onCopy: _showSensitive
                ? () => _copyText(_cardNumber.replaceAll(' ', ''))
                : null,
          ),
          _CopyDetailRow(
            label: 'Expiry Date',
            value: _showSensitive ? _expDate : '**/**',
            onCopy: _showSensitive ? () => _copyText(_expDate) : null,
          ),
          _CopyDetailRow(
            label: 'CVV',
            value: _showSensitive ? _cvv : '***',
            onCopy: _showSensitive ? () => _copyText(_cvv) : null,
          ),
          _CopyDetailRow(
            label: 'Card Holder',
            value: _holder,
            onCopy: () => _copyText(_holder),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _showSensitive ? () => _copyText(_formatAllDetails()) : null,
            icon: const Icon(Icons.copy_all),
            label: const Text('Copy All Details'),
          ),
        ],
      ),
    );
  }

  String _maskCard(String number) {
    final digits = number.replaceAll(' ', '');
    if (digits.length < 4) return '****';
    return '**** **** **** ${digits.substring(digits.length - 4)}';
  }
}

class _CopyDetailRow extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback? onCopy;

  const _CopyDetailRow({
    required this.label,
    required this.value,
    this.onCopy,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(color: Colors.grey[600], fontSize: 13)),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              ],
            ),
          ),
          if (onCopy != null)
            IconButton(
              onPressed: onCopy,
              icon: const Icon(Icons.copy_outlined, size: 20),
              tooltip: 'Copy $label',
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
    );
  }
}
