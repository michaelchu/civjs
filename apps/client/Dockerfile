FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Build application with dynamic environment variables
RUN npm run build

# Production image, copy all the files and run vite preview
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 vite

# Copy built application
COPY --from=builder --chown=vite:nodejs /app/dist ./dist
COPY --from=builder --chown=vite:nodejs /app/package*.json ./
COPY --from=deps --chown=vite:nodejs /app/node_modules ./node_modules

USER vite

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Use vite preview to serve the built application
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]