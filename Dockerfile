# Simple single-stage build for Railway deployment
FROM node:20-slim

WORKDIR /app

# Set memory limits and skip Husky in CI
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV CI=true

# Copy all source files
COPY . .

# Clean previous installs but keep package-lock.json
RUN rm -rf node_modules apps/*/node_modules

# Install dependencies with frozen lockfile for reproducible builds
RUN echo "Installing dependencies..." && npm ci

# Build the application
RUN echo "Building application..." && npm run build

# Install production dependencies for server
RUN npm ci --omit=dev --workspace=apps/server --ignore-scripts

# Copy client build to be served by server
RUN mkdir -p apps/server/public && cp -r apps/client/dist/* apps/server/public/

# Railway handles user security, skip user creation for simplicity

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "apps/server/dist/index.js"]