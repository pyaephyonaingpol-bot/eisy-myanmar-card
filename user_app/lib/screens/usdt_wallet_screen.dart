import 'package:flutter/material.dart';
import 'package:eisy_user_app/services/api_service.dart';

class UsdtWalletScreen extends StatefulWidget {
  const UsdtWalletScreen({super.key});

  @override
  State<UsdtWalletScreen> createState() => _UsdtWalletScreenState();
}

class _UsdtWalletScreenState extends State<UsdtWalletScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _wallet;
  List<dynamic> _transactions = [];
  List<dynamic> _escrowHolds = [];

  final _emailCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  bool _transferring = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _amountCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final wallet = await ApiService.instance.getUsdtWallet();
      final txRes = await ApiService.instance.getUsdtWalletTransactions();
      if (mounted) {
        setState(() {
          _wallet = wallet;
          _escrowHolds = wallet['escrow_holds'] as List<dynamic>? ?? [];
          _transactions = txRes['transactions'] as List<dynamic>? ?? [];
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _transfer() async {
    final email = _emailCtrl.text.trim();
    final amount = double.tryParse(_amountCtrl.text.trim());
    if (email.isEmpty || amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter recipient email and a valid amount')),
      );
      return;
    }

    setState(() => _transferring = true);
    try {
      await ApiService.instance.transferUsdt(
        toEmail: email,
        amountUsdt: amount,
        note: _noteCtrl.text.trim().isEmpty ? null : _noteCtrl.text.trim(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Sent \$${amount.toStringAsFixed(2)} USDT to $email')),
      );
      _emailCtrl.clear();
      _amountCtrl.clear();
      _noteCtrl.clear();
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    } finally {
      if (mounted) setState(() => _transferring = false);
    }
  }

  String _fmtUsdt(dynamic v) => '\$${(v as num?)?.toStringAsFixed(2) ?? '0.00'} USDT';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('USDT Wallet'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        FilledButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _BalanceGrid(wallet: _wallet ?? {}),
                      if (_escrowHolds.isNotEmpty) ...[
                        const SizedBox(height: 20),
                        Text('Active Escrow', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        ..._escrowHolds.map((h) {
                          final m = Map<String, dynamic>.from(h as Map);
                          return Card(
                            child: ListTile(
                              title: Text(m['label'] as String? ?? m['hold_type'] as String? ?? 'Escrow'),
                              subtitle: Text('${m['reference_type']} #${m['reference_id']}'),
                              trailing: Text(
                                _fmtUsdt(m['remaining_usdt']),
                                style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.amber),
                              ),
                            ),
                          );
                        }),
                      ],
                      const SizedBox(height: 20),
                      Text('Send to User', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _emailCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Recipient email',
                          border: OutlineInputBorder(),
                        ),
                        keyboardType: TextInputType.emailAddress,
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _amountCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Amount (USDT)',
                          border: OutlineInputBorder(),
                        ),
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _noteCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Note (optional)',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed: _transferring ? null : _transfer,
                        icon: _transferring
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.send),
                        label: Text(_transferring ? 'Sending…' : 'Send USDT'),
                      ),
                      const SizedBox(height: 24),
                      Text('Recent Transactions', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      if (_transactions.isEmpty)
                        const Text('No transactions yet.', style: TextStyle(color: Colors.grey))
                      else
                        ..._transactions.take(20).map((t) {
                          final row = Map<String, dynamic>.from(t as Map);
                          final dir = row['direction'] as String? ?? '';
                          final prefix = dir == 'credit' ? '+' : dir == 'debit' ? '−' : '';
                          return ListTile(
                            dense: true,
                            title: Text(row['tx_type'] as String? ?? '—'),
                            subtitle: Text(row['description'] as String? ?? ''),
                            trailing: Text('$prefix${(row['amount_usdt'] as num?)?.toStringAsFixed(2) ?? '0.00'}'),
                          );
                        }),
                    ],
                  ),
                ),
    );
  }
}

class _BalanceGrid extends StatelessWidget {
  final Map<String, dynamic> wallet;
  const _BalanceGrid({required this.wallet});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _BalanceTile(
          label: 'Available',
          value: wallet['balance_formatted'] as String? ?? '\$0.00 USDT',
          color: const Color(0xFF059669),
        )),
        const SizedBox(width: 8),
        Expanded(child: _BalanceTile(
          label: 'Locked',
          value: wallet['locked_formatted'] as String? ?? '\$0.00 USDT',
          color: const Color(0xFFD97706),
        )),
        const SizedBox(width: 8),
        Expanded(child: _BalanceTile(
          label: 'Total',
          value: wallet['total_formatted'] as String? ?? '\$0.00 USDT',
          color: const Color(0xFF2563EB),
        )),
      ],
    );
  }
}

class _BalanceTile extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _BalanceTile({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 11, color: color)),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: color)),
        ],
      ),
    );
  }
}
