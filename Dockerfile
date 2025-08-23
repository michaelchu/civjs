# Simple single-stage build for Railway deployment
FROM node:20-slim

WORKDIR /app

# Set memory limits and skip Husky in CI
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV CI=true

# Copy all source files
COPY . .

# Clean previous installs
RUN rm -rf node_modules apps/*/node_modules package-lock.json

# Install dependencies
RUN echo "Installing dependencies..." && npm install --verbose

# Build the application
RUN echo "Building application..." && npm run build

# Install production dependencies for server
RUN npm ci --omit=dev --workspace=apps/server --ignore-scripts

# Copy client build to be served by server
RUN mkdir -p apps/server/public && cp -r apps/client/dist/* apps/server/public/

# Create non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "apps/server/dist/index.js"]