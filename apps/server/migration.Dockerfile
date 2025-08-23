# Migration container for running database migrations
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies + tsx for TypeScript execution
RUN npm ci --omit=dev --ignore-scripts && \
    npm install tsx

# Copy migration-related files
COPY drizzle/ ./drizzle/
COPY src/scripts/migrate-prod.ts ./src/scripts/migrate-prod.ts

# Copy .env for local development (production will use env vars)
COPY .env* ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Run our custom migration script
CMD ["npx", "tsx", "src/scripts/migrate-prod.ts"]