# Running Insien Sandbox

Quick guide to run the sandbox system locally and in production.

## Local Development

### Prerequisites

Make sure you have:
- Node.js 20+ installed (`node --version`)
- Docker installed and running (`docker --version`, `docker info`)

If not, see [INSTALL.md](./INSTALL.md) for installation instructions.

### Step 1: Install Dependencies

```bash
./setup.sh
```

This will:
- Install dependencies for orchestrator, agent, and SDK
- Build Docker images for the sandbox agent

### Step 2: Configure Environment

```bash
cd orchestrator-api
cp .env.example .env
```

Edit `.env`:
```env
PORT=3000
WS_PORT=3001
JWT_SECRET=your-secret-key-change-in-production
API_KEY=test-api-key
AGENT_IMAGE=sandbox-agent:latest
ORCHESTRATOR_HOST=host.docker.internal
```

### Step 3: Start Orchestrator

```bash
cd orchestrator-api
npm start
```

You should see:
```
Orchestrator API listening on http://localhost:3000
WebSocket server listening on ws://localhost:3001
```

### Step 4: Use the SDK

In another terminal:

```bash
cd example
export INSIEN_API_KEY=test-api-key
node index.js
```

## Production Deployment

### Quick Start with Docker Compose

1. **Set environment variables:**
   ```bash
   export JWT_SECRET=$(openssl rand -base64 32)
   export API_KEY=$(openssl rand -base64 32)
   ```

2. **Build images:**
   ```bash
   cd docker
   ./build.sh
   ```

3. **Start services:**
   ```bash
   docker-compose -f docker/docker-compose.prod.yml up -d
   ```

4. **Check status:**
   ```bash
   curl http://localhost:3000/health
   ```

### With Reverse Proxy (nginx)

1. **Install nginx:**
   ```bash
   sudo apt-get install nginx
   ```

2. **Create nginx config** (`/etc/nginx/sites-available/insien-sandbox`):
   ```nginx
   upstream orchestrator {
       server localhost:3000;
   }

   upstream websocket {
       server localhost:3001;
   }

   server {
       listen 80;
       server_name your-domain.com;

       # API endpoints
       location / {
           proxy_pass http://orchestrator;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }

       # WebSocket endpoint
       location /ws {
           proxy_pass http://websocket;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_read_timeout 86400;
       }
   }
   ```

3. **Enable and restart:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/insien-sandbox /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

4. **Configure SSL with Let's Encrypt:**
   ```bash
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

### Environment Variables for Production

Create `.env.production`:

```env
PORT=3000
WS_PORT=3001
JWT_SECRET=<generate-with-openssl-rand-base64-32>
API_KEY=<generate-with-openssl-rand-base64-32>
AGENT_IMAGE=sandbox-agent:latest
ORCHESTRATOR_HOST=host.docker.internal
NODE_ENV=production
```

### SDK Configuration in Production

Users should configure the SDK with your production URL:

```javascript
const sandbox = new Sandbox({
  apiKey: 'their-api-key',
  orchestratorUrl: 'https://your-domain.com',
  wsUrl: 'wss://your-domain.com/ws'
});
```

Or set environment variables:
```bash
export INSIEN_API_KEY=their-api-key
export INSIEN_API_URL=https://your-domain.com
export INSIEN_WS_URL=wss://your-domain.com/ws
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "activeSandboxes": 5
}
```

### Check Logs

```bash
# Orchestrator logs
docker-compose -f docker/docker-compose.prod.yml logs orchestrator

# Follow logs
docker-compose -f docker/docker-compose.prod.yml logs -f orchestrator
```

### Check Active Sandboxes

```bash
docker ps | grep sandbox-
```

## Troubleshooting

### Agent Not Connecting

1. Check container logs:
   ```bash
   docker logs sandbox-<id>
   ```

2. Verify `ORCHESTRATOR_HOST`:
   - On Linux, you may need to use host IP instead of `host.docker.internal`
   - Check Docker network configuration

### WebSocket Connection Failed

1. Check firewall rules
2. Verify reverse proxy WebSocket configuration
3. Check SSL/TLS certificates

### Port Already in Use

```bash
# Find process using port
lsof -i :3000
lsof -i :3001

# Kill process
kill -9 <PID>
```

## Next Steps

- See `DEPLOYMENT.md` for advanced deployment options (Kubernetes, cloud platforms)
- See `README.md` for API documentation
- See `QUICKSTART.md` for development workflow

