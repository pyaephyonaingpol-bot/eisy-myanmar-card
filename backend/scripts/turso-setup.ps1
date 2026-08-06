# Turso setup commands (run after creating the database in https://turso.tech/app)

# 1) Create database (Turso CLI — optional if you use the web dashboard instead)
# turso auth login
# turso db create eisy-global-card
# turso db show eisy-global-card --url
# turso db tokens create eisy-global-card

# 2) Test locally (PowerShell)
# $env:DATABASE_URL = "libsql://YOUR-DB-NAME.turso.io"
# $env:DATABASE_AUTH_TOKEN = "YOUR_TOKEN"
# npm run db:test
# npm run migrate

# 3) Add to Vercel production (PowerShell, from backend/)
# npx vercel env add DATABASE_URL production
# npx vercel env add DATABASE_AUTH_TOKEN production
# npx vercel --prod --yes

# 4) Verify production
# curl https://eisymyanmar.com/health
