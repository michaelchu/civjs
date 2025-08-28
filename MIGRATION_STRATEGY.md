# Database Migration Strategy for Vercel Deployment

## ✅ Current Approach: Build-Time Migrations (Implemented)

**The project is now configured to run migrations automatically during build using `drizzle-kit push`.**

### Benefits:
- **Zero Configuration**: Migrations run automatically on each deployment
- **Safe**: Vercel's skew protection prevents compatibility issues  
- **Fast**: No startup delays or manual steps
- **Reliable**: Builds fail if migrations fail, preventing broken deployments

### How It Works:
1. **Build Script**: `drizzle-kit push && npm run build` applies schema changes during deployment
2. **Skew Protection**: Existing clients stay connected to compatible backend versions
3. **Gradual Migration**: New clients get updated schema, old clients transition safely

This is the **recommended approach for small/medium projects** and requires no manual intervention.

---

## Alternative Solutions (Historical Reference)

### The Original Problem

Vercel Functions are stateless and ephemeral, making runtime database migrations problematic:

- **No File System**: Can't write migration files or state
- **Cold Starts**: Running migrations on startup causes severe latency
- **Race Conditions**: Multiple function instances could run migrations simultaneously
- **Timeouts**: Vercel functions have execution limits (10s Hobby, 30s Pro)
- **Stateless**: Each function invocation starts fresh

### Option 1: Manual Migrations via Vercel CLI

This is the safest and most reliable approach for production deployments.

#### Setup:
```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Link your project (run from project root)
vercel link
```

#### Running Migrations:
```bash
# Pull environment variables locally
vercel env pull .env.local

# Run migrations locally against production database
cd apps/server
npm run db:migrate:prod
```

#### Workflow:
1. Deploy your code changes to Vercel
2. Run migrations locally using production database credentials
3. Verify the deployment works correctly

### Option 2: GitHub Actions (Automated)

Create a GitHub Action that runs migrations after deployment.

#### Create `.github/workflows/deploy-and-migrate.yml`:
```yaml
name: Deploy and Migrate

on:
  push:
    branches: [ main, master ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
        working-directory: ./apps/server
      
      - name: Build
        run: npm run build
        working-directory: ./apps/server
      
      - name: Run Database Migrations
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          NODE_ENV: production
        run: npm run db:migrate:prod
        working-directory: ./apps/server
```

#### Setup Required Secrets:
- Go to GitHub repo → Settings → Secrets and variables → Actions
- Add `DATABASE_URL` with your Supabase connection string

### Option 3: Separate Migration Service

Deploy a separate Vercel Function specifically for migrations.

#### Create `apps/server/api/migrate.ts`:
```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import { runMigrations } from '../src/scripts/migrate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Security: Add API key validation
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  if (apiKey !== process.env.MIGRATION_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await runMigrations();
    res.status(200).json({ success: true, message: 'Migrations completed' });
  } catch (error) {
    console.error('Migration failed:', error);
    res.status(500).json({ error: 'Migration failed' });
  }
}
```

#### Usage:
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-app.vercel.app/api/migrate
```

### Option 4: Database Schema Management Tools

Use Supabase's built-in migration tools or external schema management services.

#### Supabase CLI:
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Apply migrations
supabase db push
```

## Security Considerations

### 1. Environment Variables
- Never commit database URLs to version control
- Use Vercel's environment variables for production credentials
- Consider using different databases for staging/production

### 2. Migration API Keys
If using Option 3, generate a strong API key:
```bash
# Generate a secure API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Database Permissions
- Use a dedicated database user for migrations
- Grant minimal necessary permissions
- Consider using temporary elevated permissions for migrations

## Recommended Workflow

### For Development:
```bash
# Local development with automatic migrations
npm run start:dev  # Runs migrations then starts server
```

### For Production:
```bash
# 1. Deploy code (no migrations)
vercel --prod

# 2. Run migrations manually
vercel env pull .env.local
cd apps/server && npm run db:migrate:prod

# 3. Verify deployment
curl https://your-app.vercel.app/health
```

## Migration Best Practices

### 1. Backward Compatibility
- Make migrations additive when possible
- Avoid breaking changes during active deployments
- Use feature flags for schema changes

### 2. Testing
- Test migrations on a staging database first
- Create rollback scripts for critical changes
- Monitor application health after migrations

### 3. Monitoring
- Log migration results
- Set up alerts for migration failures
- Monitor database performance after schema changes

### 4. Rollback Strategy
```bash
# Create rollback migration
npm run db:generate  # After reverting schema changes

# Apply rollback
npm run db:migrate:prod
```

## Troubleshooting

### Common Issues:

1. **SSL Connection Errors**:
   ```
   Error: self signed certificate in certificate chain
   ```
   Solution: Ensure SSL settings match your database provider

2. **Permission Errors**:
   ```
   Error: permission denied for table
   ```
   Solution: Verify database user has necessary permissions

3. **Connection Timeouts**:
   ```
   Error: connect ETIMEDOUT
   ```
   Solution: Check firewall settings and connection limits

4. **Migration Lock Issues**:
   ```
   Error: migration lock held
   ```
   Solution: Clear the lock table manually or wait for timeout

### Debug Commands:
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT version();"

# Check migration status
npm run db:studio  # Opens Drizzle Studio

# Manual migration rollback
# Connect to database and inspect __drizzle_migrations table
```

This strategy ensures reliable, safe database migrations while maintaining the benefits of Vercel's serverless architecture.