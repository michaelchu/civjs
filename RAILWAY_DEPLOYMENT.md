# Railway Deployment Guide for CivJS

This guide will help you deploy the CivJS application to Railway.

## Prerequisites

1. A Railway account (sign up at https://railway.app)
2. GitHub repository connected to Railway
3. PostgreSQL and Redis databases provisioned on Railway

## Deployment Steps

### 1. Create a New Project on Railway

1. Log in to Railway Dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `civjs` repository
5. Railway will automatically detect the configuration

### 2. Provision Required Services

You'll need to add these services to your Railway project:

#### PostgreSQL Database
1. Click "New" → "Database" → "Add PostgreSQL"
2. Railway will automatically create a PostgreSQL instance
3. Note the `DATABASE_URL` from the Connect tab

#### Redis Cache
1. Click "New" → "Database" → "Add Redis"
2. Railway will automatically create a Redis instance
3. Note the `REDIS_URL` from the Connect tab

### 3. Configure Environment Variables

In your Railway project settings, add these environment variables:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
SOCKET_CORS_ORIGIN=${{RAILWAY_STATIC_URL}}
```

**Note**: Railway provides automatic reference variables for databases. Use the format `${{ServiceName.VARIABLE_NAME}}` to reference them.

### 4. Deploy the Application

Railway supports multiple deployment methods:

#### Option A: Automatic Deployment (Recommended)
- Railway will automatically deploy when you push to your main branch
- The `railway.json` configuration file defines the build and start commands

#### Option B: Using Railway CLI
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Deploy
railway up
```

#### Option C: Using Docker
- Railway will automatically detect the Dockerfile in the root directory
- The multi-stage build will optimize the deployment

### 5. Set Up the Client (Frontend)

For the client deployment, you have two options:

#### Option A: Serve from the Same Server
The current Dockerfile builds both client and server, with the server serving the static client files. This is the simplest approach.

#### Option B: Deploy Client Separately
1. Create a separate Railway service for the client
2. Configure it to build with `npm run build:client`
3. Use a static file server or configure Nginx

### 6. Database Migrations

Run database migrations after deployment:

```bash
# Using Railway CLI
railway run npm run db:migrate --workspace=apps/server

# Or set up automatic migrations in railway.json
```

### 7. Configure Custom Domain (Optional)

1. Go to your service settings in Railway
2. Click on "Settings" → "Domains"
3. Add your custom domain
4. Update DNS records as instructed

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `REDIS_URL` | Redis connection string | `redis://...` |
| `SOCKET_CORS_ORIGIN` | Frontend URL for CORS | `https://your-domain.com` |

## Monitoring and Logs

1. View logs in Railway Dashboard under "Deployments"
2. Use Railway CLI: `railway logs`
3. Set up monitoring with Railway's observability features

## Troubleshooting

### Common Issues

1. **Build Failures**
   - Check Node version matches (20.x)
   - Ensure all dependencies are in package.json
   - Review build logs for specific errors

2. **Database Connection Issues**
   - Verify DATABASE_URL is correctly set
   - Check if migrations have run
   - Ensure PostgreSQL service is running

3. **WebSocket Connection Issues**
   - Verify SOCKET_CORS_ORIGIN is set correctly
   - Check Railway's WebSocket support is enabled
   - Ensure the client URL is properly configured

### Health Checks

The application includes health check endpoints:
- Server health: `GET /health`
- Socket.IO health: Automatic reconnection handling

## Scaling

To scale your application:

1. Go to service settings
2. Adjust the number of replicas
3. Configure horizontal scaling rules
4. Consider upgrading Railway plan for more resources

## Backup and Recovery

1. **Database Backups**
   - Railway provides automatic backups for PostgreSQL
   - Configure backup schedule in database settings
   - Download backups from the dashboard

2. **Redis Persistence**
   - Configure Redis persistence in service settings
   - Use AOF (Append Only File) for better durability

## CI/CD Pipeline

Railway automatically sets up CI/CD:
- Push to main branch → Automatic deployment
- Pull requests → Preview deployments
- Rollback using deployment history

## Cost Optimization

1. Use Railway's usage-based pricing
2. Configure auto-sleep for development environments
3. Monitor resource usage in dashboard
4. Optimize Docker image size

## Support

- Railway Documentation: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- GitHub Issues: https://github.com/michaelchu/civjs/issues