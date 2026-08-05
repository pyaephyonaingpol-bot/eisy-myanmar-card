import 'package:flutter/material.dart';
import 'package:eisy_user_app/screens/login_screen.dart';
import 'package:eisy_user_app/screens/home_screen.dart';
import 'package:eisy_user_app/screens/pin_unlock_screen.dart';
import 'package:eisy_user_app/services/auth_service.dart';
import 'package:eisy_user_app/services/auth_storage.dart';

void main() {
  runApp(const EisyApp());
}

class EisyApp extends StatelessWidget {
  const EisyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Eisy Myanmar',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1565C0)),
        useMaterial3: true,
      ),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: AuthService.instance.isLoggedIn(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (!snapshot.data!) return const LoginScreen();
        return FutureBuilder<Map<String, dynamic>?>(
          future: AuthStorage.load(),
          builder: (context, authSnap) {
            final hasPin = authSnap.data?['pinToken'] != null;
            if (!hasPin) {
              return const PinUnlockScreen(next: HomeScreen());
            }
            return const HomeScreen();
          },
        );
      },
    );
  }
}
