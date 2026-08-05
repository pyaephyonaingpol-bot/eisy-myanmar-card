class AppConfig {
  /// Change to your backend server IP.
  /// - Android emulator: http://10.0.2.2:3000
  /// - iOS simulator: http://localhost:3000
  /// - Physical device: http://<YOUR_LAN_IP>:3000
  static const String baseUrl = 'http://10.0.2.2:3000';

  /// Demo user seeded by backend (run `npm run seed`)
  static const int demoUserId = 1;
}
