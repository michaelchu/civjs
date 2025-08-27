# CivJS Deployment Guide

This guide covers deploying CivJS to Vercel with Supabase for PostgreSQL and Upstash for Redis.

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Supabase Account**: Sign up at [supabase.com](https://supabase.com)
3. **Upstash Account**: Sign up at [upstash.com](https://upstash.com)

## Setup External Services

### Supabase (PostgreSQL)

1. Create a new project at [app.supabase.com](https://app.supabase.com)
2. Go to **Settings** → **Database**
3. Copy the **Connection String** (URI format)
4. Replace `[YOUR-PASSWORD]` with your database password

### Upstash (Redis)

1. Create a new Redis database at [console.upstash.com](https://console.upstash.com)
2. Select a region close to your users
3. Copy the **Redis URL** (starts with `rediss://`)

## Deployment Steps

### 1. Deploy the Server

1. **Connect GitHub Repository**:
   - Go to [vercel.com/dashboard](https://vercel.com/dashboard)
   - Click "New Project"
   - Import your GitHub repository
   - Select the `apps/server` directory as the root

2. **Configure Build Settings**:
   - Framework Preset: **Other**
   - Root Directory: `apps/server`
   - Build Command: `npm run vercel-build`
   - Output Directory: `dist`

3. **Set Environment Variables**:
   ```bash
   NODE_ENV=production
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   REDIS_URL=rediss://default:[TOKEN]@[ENDPOINT].upstash.io:6380
   PORT=3000
   ```

4. **Deploy** and note the deployment URL (e.g., `https://civjs-server.vercel.app`)

### 2. Run Database Migrations

⚠️ **Important**: Vercel Functions cannot run migrations automatically due to their stateless nature. You must run migrations manually.

**Recommended Approach - Manual Migrations via CLI:**

1. **Install Vercel CLI**: `npm install -g vercel`
2. **Login**: `vercel login`  
3. **Link to your project**: `vercel link`
4. **Pull environment variables**: `vercel env pull .env.local`
5. **Run migrations**: `cd apps/server && npm run db:migrate:prod`

**Alternative: Use Supabase CLI (if preferred):**
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

> 📖 **Detailed Migration Strategy**: See [MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md) for comprehensive migration options including GitHub Actions automation.

### 3. Deploy the Client

1. **Create New Vercel Project**:
   - Import the same GitHub repository
   - Select the `apps/client` directory as the root

2. **Configure Build Settings**:
   - Framework Preset: **Vite**
   - Root Directory: `apps/client`
   - Build Command: `npm run build`
   - Output Directory: `dist`

3. **Set Environment Variables**:
   ```bash
   VITE_SERVER_URL=https://your-civjs-server.vercel.app
   ```

4. **Deploy** and note the deployment URL

### 4. Update Server CORS

Update your server's environment variables:

```bash
SOCKET_CORS_ORIGIN=https://your-civjs-client.vercel.app
```

Redeploy the server after updating the CORS origin.

## Environment Variables Reference

### Server Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `DATABASE_URL` | Supabase PostgreSQL connection string | `postgresql://postgres:pass@db.ref.supabase.co:5432/postgres` |
| `REDIS_URL` | Upstash Redis connection string | `rediss://default:token@endpoint.upstash.io:6380` |
| `PORT` | Server port | `3000` |
| `SOCKET_CORS_ORIGIN` | Client URL for CORS | `https://your-client.vercel.app` |
| `MAX_PLAYERS_PER_GAME` | Maximum players per game | `8` |
| `TURN_TIMEOUT_SECONDS` | Turn timeout in seconds | `120` |
| `LOG_LEVEL` | Logging level | `info` |

### Client Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SERVER_URL` | Server URL | `https://your-server.vercel.app` |

## Troubleshooting

### Database Connection Issues

- Ensure your DATABASE_URL includes the correct password
- Verify the SSL configuration is enabled for production
- Check that your Supabase project allows connections from Vercel's IP ranges

### Redis Connection Issues

- Ensure you're using the `rediss://` protocol (SSL)
- Verify your Upstash Redis URL is correct
- Check that TLS is properly configured

### CORS Issues

- Verify `SOCKET_CORS_ORIGIN` matches your client URL exactly
- Ensure both HTTP and WebSocket connections are allowed
- Check that your client is using the correct server URL

### Build Issues

- Ensure all dependencies are listed in `package.json`
- Check that TypeScript compiles without errors: `npm run type-check`
- Verify environment variables are set during build

## Production Considerations

1. **Scaling**: Both Vercel functions and Supabase/Upstash scale automatically
2. **Monitoring**: Use Vercel Analytics and Supabase Dashboard for monitoring
3. **Security**: Environment variables are encrypted in Vercel
4. **Backups**: Supabase provides automatic backups
5. **CDN**: Vercel provides global CDN for static assets

## Migration from Docker

If you were previously using Docker for development:

- **Local Development**: Continue using `npm run docker:up` for local PostgreSQL/Redis
- **Production**: No longer need Docker containers - Vercel handles hosting
- **Database**: Replace local PostgreSQL with Supabase
- **Redis**: Replace local Redis with Upstash
- **Migrations**: No longer automatic on startup (see migration strategy above)

## Cost Optimization

- Use Vercel's Pro plan for production workloads
- Monitor Supabase database usage and upgrade as needed  
- Upstash has a generous free tier for Redis
- Consider enabling Vercel Analytics for insights