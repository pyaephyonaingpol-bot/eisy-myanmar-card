import 'package:flutter/material.dart';
import 'package:eisy_user_app/services/api_service.dart';
import 'package:eisy_user_app/services/auth_service.dart';
import 'package:eisy_user_app/screens/deposit_screen.dart';
import 'package:eisy_user_app/screens/usdt_wallet_screen.dart';
import 'package:eisy_user_app/screens/card_details_screen.dart';
import 'package:eisy_user_app/screens/login_screen.dart';
import 'package:eisy_user_app/widgets/card_preview.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  double _balance = 0;
  double _usdtAvailable = 0;
  double _usdtLocked = 0;
  List<Map<String, dynamic>> _cards = [];
  int _activeIndex = 0;
  bool _loading = true;
  String? _error;
  late final PageController _pageController;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _loadData();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Map<String, dynamic>? get _activeCard =>
      _cards.isEmpty ? null : _cards[_activeIndex];

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final wallet = await ApiService.instance.getWallet();
      List<Map<String, dynamic>> cards = [];
      var activeIndex = 0;
      try {
        final cardRes = await ApiService.instance.getCards();
        cards = (cardRes['cards'] as List<dynamic>?)
                ?.map((e) => Map<String, dynamic>.from(e as Map))
                .toList() ??
            [];
        activeIndex = (cardRes['active_index'] as num?)?.toInt() ?? 0;
      } catch (_) {
        cards = [];
      }
      if (mounted) {
        setState(() {
          _balance = (wallet['balance'] as num?)?.toDouble() ?? (wallet['balance_mmk'] as num?)?.toDouble() ?? 0;
          _usdtAvailable = (wallet['balance_usdt'] as num?)?.toDouble() ?? 0;
          _usdtLocked = (wallet['balance_usdt_locked'] as num?)?.toDouble() ?? 0;
          _cards = cards;
          _activeIndex = cards.isEmpty ? 0 : activeIndex.clamp(0, cards.length - 1);
          _loading = false;
        });
        if (_cards.isNotEmpty && _pageController.hasClients) {
          _pageController.jumpToPage(_activeIndex);
        }
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

  void _selectCard(int index) {
    if (index < 0 || index >= _cards.length) return;
    setState(() => _activeIndex = index);
    _pageController.animateToPage(
      index,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  void _nextCard() => _selectCard((_activeIndex + 1) % _cards.length);
  void _prevCard() => _selectCard((_activeIndex - 1 + _cards.length) % _cards.length);

  Future<void> _logout() async {
    await AuthService.instance.logout();
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Eisy Myanmar'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadData),
          IconButton(icon: const Icon(Icons.logout), onPressed: _logout),
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
                        const Icon(Icons.lock_outline, size: 48, color: Colors.orange),
                        const SizedBox(height: 16),
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        FilledButton(onPressed: _loadData, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      _BalanceCard(balance: _balance),
                      const SizedBox(height: 12),
                      _UsdtBalanceCard(available: _usdtAvailable, locked: _usdtLocked),
                      if (_cards.isNotEmpty) ...[
                        const SizedBox(height: 20),
                        _CardSelectorHeader(
                          count: _cards.length,
                          activeIndex: _activeIndex,
                          onPrev: _cards.length > 1 ? _prevCard : null,
                          onNext: _cards.length > 1 ? _nextCard : null,
                        ),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<int>(
                          value: _activeIndex,
                          decoration: const InputDecoration(
                            labelText: 'Your Virtual Cards',
                            border: OutlineInputBorder(),
                          ),
                          items: [
                            for (var i = 0; i < _cards.length; i++)
                              DropdownMenuItem(
                                value: i,
                                child: Text(_cards[i]['label'] as String? ?? 'Card $i'),
                              ),
                          ],
                          onChanged: (v) {
                            if (v != null) _selectCard(v);
                          },
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          height: 88,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: _cards.length,
                            separatorBuilder: (_, __) => const SizedBox(width: 10),
                            itemBuilder: (context, i) {
                              final c = _cards[i];
                              final selected = i == _activeIndex;
                              return _CardThumb(
                                label: c['label'] as String? ?? 'Card',
                                last4: c['last4'] as String? ?? '????',
                                status: c['status'] as String? ?? 'active',
                                balance: (c['balance_usd'] as num?)?.toDouble(),
                                selected: selected,
                                onTap: () => _selectCard(i),
                              );
                            },
                          ),
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          height: 200,
                          child: PageView.builder(
                            controller: _pageController,
                            itemCount: _cards.length,
                            onPageChanged: (i) => setState(() => _activeIndex = i),
                            itemBuilder: (context, i) {
                              final c = _cards[i];
                              final pending = c['status'] == 'pending';
                              if (pending) {
                                return _PendingCardTile(holder: c['card_holder_name'] as String? ?? '—');
                              }
                              return CardPreview(
                                cardNumber: c['card_number'] as String,
                                holderName: c['card_holder_name'] as String,
                                expDate: c['exp_date'] as String?,
                                cvv: c['cvv'] as String?,
                                masked: true,
                              );
                            },
                          ),
                        ),
                        if (_activeCard?['balance_usd'] != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              'Card balance: \$${(_activeCard!['balance_usd'] as num).toStringAsFixed(2)} USD',
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                          ),
                      ],
                      const SizedBox(height: 24),
                      Row(
                        children: [
                          Expanded(
                            child: _ActionButton(
                              icon: Icons.add_card,
                              label: 'Deposit',
                              onTap: () async {
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute(builder: (_) => const DepositScreen()),
                                );
                                _loadData();
                              },
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: _ActionButton(
                              icon: Icons.account_balance_wallet,
                              label: 'USDT Wallet',
                              onTap: () async {
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute(builder: (_) => const UsdtWalletScreen()),
                                );
                                _loadData();
                              },
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: _ActionButton(
                              icon: Icons.credit_card,
                              label: 'View Card',
                              onTap: _activeCard == null || _activeCard!['status'] == 'pending'
                                  ? null
                                  : () {
                                      Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => CardDetailsScreen(card: _activeCard!),
                                        ),
                                      );
                                    },
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
    );
  }
}

class _CardSelectorHeader extends StatelessWidget {
  final int count;
  final int activeIndex;
  final VoidCallback? onPrev;
  final VoidCallback? onNext;

  const _CardSelectorHeader({
    required this.count,
    required this.activeIndex,
    this.onPrev,
    this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(
          child: Text('Your Virtual Cards', style: TextStyle(fontWeight: FontWeight.w600)),
        ),
        IconButton(onPressed: onPrev, icon: const Icon(Icons.chevron_left), tooltip: 'Previous card'),
        Text('${activeIndex + 1} / $count', style: TextStyle(color: Colors.grey[600])),
        IconButton(onPressed: onNext, icon: const Icon(Icons.chevron_right), tooltip: 'Next card'),
      ],
    );
  }
}

class _CardThumb extends StatelessWidget {
  final String label;
  final String last4;
  final String status;
  final double? balance;
  final bool selected;
  final VoidCallback onTap;

  const _CardThumb({
    required this.label,
    required this.last4,
    required this.status,
    this.balance,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: status == 'pending'
          ? Colors.grey.shade700
          : const Color(0xFF3949AB),
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 130,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected ? Colors.lightBlueAccent : Colors.transparent,
              width: 2,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('EISY', style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 10)),
              Text(
                status == 'pending' ? 'Pending' : '•••• $last4',
                style: const TextStyle(color: Colors.white, fontFamily: 'monospace', fontSize: 13),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(status, style: TextStyle(color: Colors.white.withOpacity(0.75), fontSize: 10)),
                  Text(
                    balance != null ? '\$${balance!.toStringAsFixed(0)}' : '—',
                    style: TextStyle(color: Colors.white.withOpacity(0.75), fontSize: 10),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PendingCardTile extends StatelessWidget {
  final String holder;
  const _PendingCardTile({required this.holder});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.grey.shade800,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.orange.shade700),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('Pending card request', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text('Holder: $holder', style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: 4),
          const Text('Admin will assign your card number soon.', style: TextStyle(color: Colors.white54, fontSize: 12)),
        ],
      ),
    );
  }
}

class _UsdtBalanceCard extends StatelessWidget {
  final double available;
  final double locked;

  const _UsdtBalanceCard({required this.available, required this.locked});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF064E3B).withOpacity(0.25),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF10B981).withOpacity(0.35)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('USDT Available', style: TextStyle(color: Colors.green.shade200, fontSize: 12)),
                Text('\$${available.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          if (locked > 0)
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('Locked', style: TextStyle(color: Colors.amber.shade200, fontSize: 12)),
                  Text('\$${locked.toStringAsFixed(2)}', style: const TextStyle(color: Colors.amber, fontSize: 16, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  final double balance;
  const _BalanceCard({required this.balance});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1565C0), Color(0xFF0D47A1)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Wallet Balance',
            style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 14),
          ),
          const SizedBox(height: 8),
          Text(
            '\$${balance.toStringAsFixed(2)} USD',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 32,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  const _ActionButton({required this.icon, required this.label, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: Column(
            children: [
              Icon(icon, size: 32, color: onTap == null ? Colors.grey : null),
              const SizedBox(height: 8),
              Text(label, style: TextStyle(color: onTap == null ? Colors.grey : null)),
            ],
          ),
        ),
      ),
    );
  }
}
