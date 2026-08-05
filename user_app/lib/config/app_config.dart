class AppConfig {
  /// Production backend API (Vercel).
  /// - Local dev: http://localhost:3000
  /// - Android emulator: http://10.0.2.2:3000
  static const String baseUrl = 'https://eisy-global-card.vercel.app';

  /// Demo user seeded by backend (run `npm run seed`)
  static const int demoUserId = 1;
}
