# Deployment Guide for Render

## Prerequisites

1. GitHub repository with your code
2. Render account (free tier works)
3. Supabase project already set up

## Deployment Steps

### 1. Push to GitHub

```bash
git add .
git commit -m "Add Render deployment configuration"
git push origin master
```

### 2. Update render.yaml

Edit `render.yaml` and replace:

- `YOUR_GITHUB_USERNAME` with your actual GitHub username
- After first deploy, update the URLs with your actual Render URLs

### 3. Create Services on Render

#### Option A: Blueprint (Recommended)

1. Go to [render.com](https://render.com)
2. Click "New +" → "Blueprint"
3. Connect your GitHub repository
4. Render will detect `render.yaml` and create both services

#### Option B: Manual Setup

Create two separate services:

**Backend Service:**

1. New → Web Service
2. Connect repo, set root directory to `/server`
3. Build: `npm install && npm run build`
4. Start: `npm run start`

**Frontend Service:**

1. New → Static Site
2. Connect repo, set root directory to `/client`
3. Build: `npm install && npm run build`
4. Publish: `dist`

### 4. Configure Environment Variables

In the Render dashboard for your **backend service**, add:

```
NODE_ENV=production
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
CLIENT_URL=https://your-frontend.onrender.com
```

For the **frontend service**, add:

```
VITE_API_URL=https://your-backend.onrender.com
VITE_WS_URL=wss://your-backend.onrender.com
```

### 5. Update URLs After Deploy

Once deployed, you'll get URLs like:

- Backend: `https://civjs-server-abc123.onrender.com`
- Frontend: `https://civjs-client-xyz789.onrender.com`

Update these in:

1. Backend env var: `CLIENT_URL`
2. Frontend env vars: `VITE_API_URL` and `VITE_WS_URL`
3. Redeploy both services

## Important Notes

- **Free Tier Limitations**: Services spin down after 15 min of inactivity
- **Cold Starts**: First request after spin-down takes ~30 seconds
- **WebSockets**: Work on free tier but disconnect during spin-down
- **Custom Domains**: Available on paid plans

## Troubleshooting

### CORS Issues

- Ensure CLIENT_URL in backend matches your frontend URL exactly
- Check that both URLs use https:// in production

### WebSocket Connection Failed

- Verify VITE_WS_URL uses wss:// (not ws://) in production
- Check backend logs for connection attempts

### Build Failures

- Ensure all dependencies are in package.json (not devDependencies)
- Check build logs in Render dashboard

### Database Connection Issues

- Verify Supabase environment variables are set correctly
- Check that Supabase project is active and not paused
