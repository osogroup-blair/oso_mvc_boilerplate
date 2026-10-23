#!/usr/bin/env bash
# One-command bootstrap. Idempotent — safe to run repeatedly.
set -euo pipefail

echo "▶ MVC boilerplate setup"

# 1. Env file
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✓ created .env from .env.example"
else
  echo "  • .env already exists, leaving it"
fi

# 2. Dependencies
echo "▶ Installing dependencies..."
npm ci

# 3. Database (Docker). Falls through with a warning if Docker is absent.
if command -v docker >/dev/null 2>&1; then
  echo "▶ Starting Postgres via Docker..."
  docker compose -f docker-compose.yml -f compose.host.yml up -d db
  echo "  ⏳ waiting for Postgres to accept connections..."
  until docker compose exec -T db pg_isready -U boilerplate >/dev/null 2>&1; do
    sleep 1
  done
  echo "  ✓ Postgres is ready"
else
  echo "  ⚠ Docker not found. Ensure DATABASE_URL in .env points to a running Postgres, then re-run."
fi

# 4. Prisma: generate client, run migrations, seed
echo "▶ Setting up database schema..."
npx prisma generate
npx prisma migrate deploy
echo "▶ Seeding database..."
npm run db:seed

# 5. Build CSS
echo "▶ Building CSS..."
npm run css:build

echo ""
echo "✅ Setup complete. Starting dev server on http://localhost:3000"
echo "   Admin area:  http://localhost:3000/admin/user"
echo ""
npm run dev

