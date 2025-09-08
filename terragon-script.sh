#!/bin/bash
set -euo pipefail

echo "==> Setting up CivJS environment with Terragon"

# --- Postgres configuration ---
PG_VER=16
PG_NAME=civjs-dev-pg
PG_USER=civjs_dev
PG_PASS=civjs_dev
PG_DB=civjs_dev
PG_PORT=5432

# --- Redis configuration ---
REDIS_NAME=civjs-dev-redis
REDIS_PORT=6379

# 1) Clean up any existing containers
echo "==> Cleaning up existing containers..."
docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
docker rm -f "$REDIS_NAME" >/dev/null 2>&1 || true

# 2) Start PostgreSQL
echo "==> Starting PostgreSQL..."
docker run -d --name "$PG_NAME" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB="$PG_DB" \
  -p 127.0.0.1:${PG_PORT}:5432 \
  postgres:${PG_VER}-alpine

# 3) Start Redis
echo "==> Starting Redis..."
docker run -d --name "$REDIS_NAME" \
  -p 127.0.0.1:${REDIS_PORT}:6379 \
  redis:7-alpine

# 4) Wait for services to be ready
echo "==> Waiting for PostgreSQL..."
for i in {1..60}; do
  if docker exec "$PG_NAME" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    echo "PostgreSQL is ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "PostgreSQL failed to start within 60 seconds"
    exit 1
  fi
  sleep 1
done

echo "==> Waiting for Redis..."
for i in {1..30}; do
  if docker exec "$REDIS_NAME" redis-cli ping >/dev/null 2>&1; then
    echo "Redis is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Redis failed to start within 30 seconds"
    exit 1
  fi
  sleep 1
done

# 5) Set environment variables
DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}?sslmode=disable"
REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"

# Add environment variables to bashrc for persistence
echo "==> Setting up environment variables..."
{
  echo ""
  echo "# CivJS Environment Variables"
  echo "export DATABASE_URL='${DATABASE_URL}'"
  echo "export REDIS_URL='${REDIS_URL}'"
  echo "export PORT=3001"
  echo "export SOCKET_CORS_ORIGIN='http://localhost:3000'"
} >> ~/.bashrc

# Export for current session
export DATABASE_URL="$DATABASE_URL"
export REDIS_URL="$REDIS_URL"
export PORT=3001
export SOCKET_CORS_ORIGIN='http://localhost:3000'

# 6) Install Node.js dependencies
echo "==> Installing Node.js dependencies..."
npm ci

# 7) Install dependencies for client and server
echo "==> Installing client dependencies..."
cd apps/client && npm ci && cd ../..

echo "==> Installing server dependencies..."
cd apps/server && npm ci && cd ../..

# 8) Run database migrations
echo "==> Running database migrations..."
cd apps/server
npm run db:migrate
cd ../..

# 9) Run linter and type checks
echo "==> Running linter and type checks..."
npm run lint
npm run typecheck

echo "==> Environment setup complete!"
echo "    DATABASE_URL: $DATABASE_URL"
echo "    REDIS_URL: $REDIS_URL"
echo ""
echo "Available commands:"
echo "  npm run dev              # Start both client and server"
echo "  npm run dev:client       # Start only frontend (port 3000)"
echo "  npm run dev:server       # Start only backend (port 3001)"
echo "  npm run test             # Run all tests"
echo "  npm run lint             # Lint all workspaces"
echo "  npm run typecheck        # Type check all workspaces"