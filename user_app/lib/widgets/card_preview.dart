import 'package:flutter/material.dart';

class CardPreview extends StatelessWidget {
  final String cardNumber;
  final String holderName;
  final String? expDate;
  final String? cvv;
  final bool masked;

  const CardPreview({
    super.key,
    required this.cardNumber,
    required this.holderName,
    this.expDate,
    this.cvv,
    this.masked = true,
  });

  String get _displayNumber {
    if (!masked) return _formatNumber(cardNumber);
    final digits = cardNumber.replaceAll(' ', '');
    if (digits.length < 4) return '**** **** **** ****';
    return '**** **** **** ${digits.substring(digits.length - 4)}';
  }

  String _formatNumber(String raw) {
    final digits = raw.replaceAll(' ', '');
    final buffer = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && i % 4 == 0) buffer.write(' ');
      buffer.write(digits[i]);
    }
    return buffer.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 200,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1A237E), Color(0xFF3949AB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'EISY GLOBAL',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 12,
                  letterSpacing: 2,
                ),
              ),
              Icon(Icons.contactless, color: Colors.white.withOpacity(0.8)),
            ],
          ),
          Text(
            _displayNumber,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              letterSpacing: 2,
              fontWeight: FontWeight.w500,
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('CARD HOLDER', style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 10)),
                  Text(
                    holderName.toUpperCase(),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
                  ),
                ],
              ),
              if (expDate != null)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('EXPIRES', style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 10)),
                    Text(
                      masked ? '**/**' : expDate!,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              if (cvv != null && !masked)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('CVV', style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 10)),
                    Text(cvv!, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}
