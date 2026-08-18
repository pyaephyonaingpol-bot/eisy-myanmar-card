const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://10.0.2.2:3000',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  'ionic://localhost',
  'https://eisymyanmar.com',
  'https://www.eisymyanmar.com',
  'https://web-chi-sand-18.vercel.app',
  'https://eisy-myanmar-app.vercel.app',
  'https://eisy-global-card.vercel.app',
  'https://eisymyanmar-app.vercel.app',
];

function parseOrigins(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

function getAllowedOrigins() {
  const fromEnv = [
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
    ...parseOrigins(process.env.PUBLIC_BASE_URL),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL.replace(/\/$/, '')}`] : []),
    ...(process.env.VERCEL_PROJECT_PRODUCTION_URL ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, '')}`] : []),
  ];
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Admin-Key',
  'X-Pin-Token',
  'X-Biometric-Token',
  'X-Deposit-Listener-Secret',
  'X-Listener-Secret',
  'X-Device-Name',
  'X-Device-Platform',
  'X-NOWPAYMENTS-SIG',
  'x-nowpayments-sig',
  'BinancePay-Timestamp',
  'BinancePay-Nonce',
  'BinancePay-Signature',
  'BinancePay-Certificate-SN',
  'Accept',
  'Origin',
  'X-Requested-With',
  'Cache-Control',
  'Pragma',
  'Range',
  'X-Forwarded-For',
  'X-Real-IP',
];

function createCorsOptions() {
  const allowedOrigins = getAllowedOrigins();

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = String(origin).trim().replace(/\/$/, '');
      if (allowedOrigins.includes(normalized)) {
        callback(null, true);
        return;
      }
      // Vercel preview & branch deployments
      if (/^https:\/\/[a-z0-9-_.]+\.vercel\.app$/i.test(normalized)) {
        callback(null, true);
        return;
      }
      // Local development origins with arbitrary ports
      if (/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:[0-9]+)?$/i.test(normalized)) {
        callback(null, true);
        return;
      }
      // Native / hybrid webview origins
      if (/^(capacitor|ionic|http|https):\/\/localhost(:[0-9]+)?$/i.test(normalized)) {
        callback(null, true);
        return;
      }
      // Disallow origin gracefully without throwing an uncaught 500 error
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ['Content-Length', 'Content-Range', 'X-Total-Count', 'X-Request-Id'],
    maxAge: 86400,
  };
}

module.exports = { createCorsOptions, getAllowedOrigins, ALLOWED_HEADERS };
