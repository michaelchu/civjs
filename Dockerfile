# Multi-stage build for production deployment
FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy root package files and workspace structure
COPY package*.json ./
COPY apps/server/package*.json ./apps/server/
COPY apps/client/package*.json ./apps/client/

# Install dependencies with npm workspaces
RUN npm ci

# Build the source code
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/apps/client/node_modules ./apps/client/node_modules

# Copy all source files
COPY . .

# Build all workspaces
RUN npm run build

# Production image - run the server
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 nodejs

# Copy necessary files for production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/server/package*.json ./apps/server/
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/client/dist ./apps/client/dist

# Install production dependencies only
RUN npm ci --omit=dev --workspace=apps/server

# Copy client build to be served by server
RUN mkdir -p apps/server/public
RUN cp -r apps/client/dist/* apps/server/public/

# Change ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "apps/server/dist/index.js"]