const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://eisymyanmar.com',
  'https://www.eisymyanmar.com',
  'https://web-chi-sand-18.vercel.app',
  'https://eisy-myanmar-app.vercel.app',
  'https://eisy-global-card.vercel.app',
  'https://eisymyanmar-app.vercel.app',
];

function parseOrigins(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function getAllowedOrigins() {
  const fromEnv = [
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
  ];
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

function createCorsOptions() {
  const allowedOrigins = getAllowedOrigins();

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Pin-Token'],
  };
}

module.exports = { createCorsOptions, getAllowedOrigins };
