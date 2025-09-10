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

# --- Test database configuration ---
TEST_PG_NAME=civjs-test-pg
TEST_PG_USER=civjs
TEST_PG_PASS=civjs_secret
TEST_PG_DB=civjs_test
TEST_PG_PORT=5433

# --- Redis configuration ---
REDIS_NAME=civjs-dev-redis
REDIS_PORT=6379

# 1) Clean up any existing containers
echo "==> Cleaning up existing containers..."
docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
docker rm -f "$TEST_PG_NAME" >/dev/null 2>&1 || true
docker rm -f "$REDIS_NAME" >/dev/null 2>&1 || true

# 2) Start PostgreSQL (Development)
echo "==> Starting PostgreSQL for development..."
docker run -d --name "$PG_NAME" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB="$PG_DB" \
  -p 127.0.0.1:${PG_PORT}:5432 \
  postgres:${PG_VER}-alpine

# 2b) Start PostgreSQL (Test Database)
echo "==> Starting PostgreSQL for tests..."
docker run -d --name "$TEST_PG_NAME" \
  -e POSTGRES_USER="$TEST_PG_USER" \
  -e POSTGRES_PASSWORD="$TEST_PG_PASS" \
  -e POSTGRES_DB="$TEST_PG_DB" \
  -p 127.0.0.1:${TEST_PG_PORT}:5432 \
  postgres:${PG_VER}-alpine

# 3) Start Redis
echo "==> Starting Redis..."
docker run -d --name "$REDIS_NAME" \
  -p 127.0.0.1:${REDIS_PORT}:6379 \
  redis:7-alpine

# 4) Wait for services to be ready
echo "==> Waiting for development PostgreSQL..."
for i in {1..60}; do
  if docker exec "$PG_NAME" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    echo "Development PostgreSQL is ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Development PostgreSQL failed to start within 60 seconds"
    exit 1
  fi
  sleep 1
done

echo "==> Waiting for test PostgreSQL..."
for i in {1..60}; do
  if docker exec "$TEST_PG_NAME" pg_isready -U "$TEST_PG_USER" >/dev/null 2>&1; then
    echo "Test PostgreSQL is ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Test PostgreSQL failed to start within 60 seconds"
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
TEST_DATABASE_URL="postgresql://${TEST_PG_USER}:${TEST_PG_PASS}@127.0.0.1:${TEST_PG_PORT}/${TEST_PG_DB}?sslmode=disable"
REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"

# Add environment variables to bashrc for persistence
echo "==> Setting up environment variables..."
{
  echo ""
  echo "# CivJS Environment Variables"
  echo "export DATABASE_URL='${DATABASE_URL}'"
  echo "export TEST_DATABASE_URL='${TEST_DATABASE_URL}'"
  echo "export REDIS_URL='${REDIS_URL}'"
  echo "export PORT=3001"
  echo "export SOCKET_CORS_ORIGIN='http://localhost:3000'"
  echo ""
  echo "# Helper function to switch to test database"
  echo "export_test_db() {"
  echo "  export DATABASE_URL='${TEST_DATABASE_URL}'"
  echo "  echo 'DATABASE_URL set to test database: \$DATABASE_URL'"
  echo "}"
  echo ""
  echo "# Helper function to switch back to dev database"
  echo "export_dev_db() {"
  echo "  export DATABASE_URL='${DATABASE_URL}'"
  echo "  echo 'DATABASE_URL set to development database: \$DATABASE_URL'"
  echo "}"
} >> ~/.bashrc

# Export for current session
export DATABASE_URL="$DATABASE_URL"
export TEST_DATABASE_URL="$TEST_DATABASE_URL"
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

# 8) Run database migrations and setup
echo "==> Running database migrations for development..."
cd apps/server
npm run db:migrate
cd ../..

echo "==> Setting up test database schema..."
cd apps/server
DATABASE_URL="$TEST_DATABASE_URL" npm run db:push:force
cd ../..

echo "==> Environment setup complete!"
echo "    Development DATABASE_URL: $DATABASE_URL"
echo "    Test DATABASE_URL: $TEST_DATABASE_URL"
echo "    REDIS_URL: $REDIS_URL"
echo ""
echo "==> Databases running:"
echo "    Development PostgreSQL: localhost:${PG_PORT} (user: ${PG_USER}, db: ${PG_DB})"
echo "    Test PostgreSQL: localhost:${TEST_PG_PORT} (user: ${TEST_PG_USER}, db: ${TEST_PG_DB})"
echo "    Redis: localhost:${REDIS_PORT}"
echo ""
echo "Available commands:"
echo "  npm run dev              # Start both client and server"
echo "  npm run dev:client       # Start only frontend (port 3000)"
echo "  npm run dev:server       # Start only backend (port 3001)"
echo "  npm run test             # Run all tests (unit + integration)"
echo "  npm run test:integration # Run integration tests only"
echo "  npm run lint             # Lint all workspaces"
echo "  npm run typecheck        # Type check all workspaces"
echo ""
echo "Integration test usage:"
echo "  DATABASE_URL=\"\$TEST_DATABASE_URL\" npm run test:integration"
echo "  # Or use helper functions:"
echo "  export_test_db && npm run test:integration && export_dev_db"
