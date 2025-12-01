# Deployment Guide

This guide covers how to run Insien Sandbox locally and deploy it to production.

## Local Development

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- npm or yarn

### Quick Start

1. **Clone and setup:**
   ```bash
   git clone <your-repo>
   cd sandbox
   ./setup.sh
   ```

2. **Configure orchestrator:**
   ```bash
   cd orchestrator-api
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start the orchestrator:**
   ```bash
   cd orchestrator-api
   npm start
   ```

4. **Run the example:**
   ```bash
   cd example
   export INSIEN_API_KEY=test-api-key
   node index.js
   ```

### Development Workflow

For development with auto-reload:

```bash
# Terminal 1: Start orchestrator with watch mode
cd orchestrator-api
npm run dev

# Terminal 2: Run example
cd example
node index.js
```

## Production Deployment

### Architecture Overview

```
┌─────────────┐
│   Clients   │
│  (SDK)      │
└──────┬──────┘
       │ HTTPS/WSS
       ▼
┌─────────────────────┐
│  Load Balancer      │
│  (nginx/traefik)    │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Orchestrator API   │
│  (Multiple Instances)│
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Docker Daemon      │
│  (Sandbox Containers)│
└─────────────────────┘
```

### Option 1: Docker Compose (Recommended for Small/Medium Scale)

#### Setup

1. **Create production environment file:**
   ```bash
   cd orchestrator-api
   cat > .env.production << EOF
   PORT=3000
   WS_PORT=3001
   JWT_SECRET=$(openssl rand -base64 32)
   API_KEY=$(openssl rand -base64 32)
   AGENT_IMAGE=sandbox-agent:latest
   ORCHESTRATOR_HOST=host.docker.internal
   NODE_ENV=production
   EOF
   ```

2. **Build images:**
   ```bash
   cd docker
   ./build.sh
   ```

3. **Start with docker-compose:**
   ```bash
   docker-compose -f docker/docker-compose.yml up -d
   ```

#### With Reverse Proxy (nginx)

Create `docker/nginx.conf`:

```nginx
upstream orchestrator {
    server orchestrator:3000;
}

upstream websocket {
    server orchestrator:3001;
}

server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # API endpoints
    location / {
        proxy_pass http://orchestrator;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
```

### Option 2: Kubernetes Deployment

#### Prerequisites

- Kubernetes cluster
- kubectl configured
- Docker images pushed to a registry

#### Steps

1. **Build and push images:**
   ```bash
   # Build
   docker build -t your-registry/sandbox-agent:latest -f docker/Dockerfile .
   docker build -t your-registry/orchestrator:latest -f docker/Dockerfile.orchestrator .

   # Push
   docker push your-registry/sandbox-agent:latest
   docker push your-registry/orchestrator:latest
   ```

2. **Create Kubernetes manifests:**

   `k8s/namespace.yaml`:
   ```yaml
   apiVersion: v1
   kind: Namespace
   metadata:
     name: insien-sandbox
   ```

   `k8s/configmap.yaml`:
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: orchestrator-config
     namespace: insien-sandbox
   data:
     PORT: "3000"
     WS_PORT: "3001"
     AGENT_IMAGE: "your-registry/sandbox-agent:latest"
     ORCHESTRATOR_HOST: "orchestrator-service"
   ```

   `k8s/secret.yaml`:
   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: orchestrator-secrets
     namespace: insien-sandbox
   type: Opaque
   stringData:
     JWT_SECRET: "your-jwt-secret-here"
     API_KEY: "your-api-key-here"
   ```

   `k8s/deployment.yaml`:
   ```yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: orchestrator
     namespace: insien-sandbox
   spec:
     replicas: 3
     selector:
       matchLabels:
         app: orchestrator
     template:
       metadata:
         labels:
           app: orchestrator
       spec:
         containers:
         - name: orchestrator
           image: your-registry/orchestrator:latest
           ports:
           - containerPort: 3000
           - containerPort: 3001
           envFrom:
           - configMapRef:
               name: orchestrator-config
           - secretRef:
               name: orchestrator-secrets
           volumeMounts:
           - name: docker-sock
             mountPath: /var/run/docker.sock
         volumes:
         - name: docker-sock
           hostPath:
             path: /var/run/docker.sock
   ```

   `k8s/service.yaml`:
   ```yaml
   apiVersion: v1
   kind: Service
   metadata:
     name: orchestrator-service
     namespace: insien-sandbox
   spec:
     selector:
       app: orchestrator
     ports:
     - name: http
       port: 3000
       targetPort: 3000
     - name: ws
       port: 3001
       targetPort: 3001
     type: LoadBalancer
   ```

3. **Deploy:**
   ```bash
   kubectl apply -f k8s/
   ```

### Option 3: Cloud Platform Deployment

#### AWS (ECS/Fargate)

1. **Create ECR repositories:**
   ```bash
   aws ecr create-repository --repository-name sandbox-agent
   aws ecr create-repository --repository-name orchestrator
   ```

2. **Build and push:**
   ```bash
   # Login to ECR
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

   # Build and tag
   docker build -t sandbox-agent:latest -f docker/Dockerfile .
   docker tag sandbox-agent:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/sandbox-agent:latest
   docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/sandbox-agent:latest
   ```

3. **Create ECS task definition** (use AWS Console or Terraform)

#### Google Cloud Platform (GKE)

Similar to Kubernetes deployment above, but use GCR/GAR for container registry.

#### DigitalOcean App Platform

1. **Create `app.yaml`:**
   ```yaml
   name: insien-sandbox
   services:
   - name: orchestrator
     github:
       repo: your-org/sandbox
       branch: main
     dockerfile_path: docker/Dockerfile.orchestrator
     envs:
     - key: JWT_SECRET
       scope: RUN_TIME
       type: SECRET
     - key: API_KEY
       scope: RUN_TIME
       type: SECRET
     http_port: 3000
     instance_count: 2
     instance_size_slug: basic-xxl
   ```

2. **Deploy via CLI:**
   ```bash
   doctl apps create --spec app.yaml
   ```

## Environment Variables

### Orchestrator Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | HTTP API port | `3000` |
| `WS_PORT` | WebSocket port | `3001` |
| `JWT_SECRET` | Secret for JWT tokens | Generate with `openssl rand -base64 32` |
| `API_KEY` | API key for authentication | Generate with `openssl rand -base64 32` |
| `AGENT_IMAGE` | Docker image for sandbox agent | `sandbox-agent:latest` |
| `ORCHESTRATOR_HOST` | Hostname for agent connections | `host.docker.internal` or service name |

### SDK Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INSIEN_API_KEY` | API key | Required |
| `INSIEN_API_URL` | Orchestrator API URL | `http://localhost:3000` |
| `INSIEN_WS_URL` | WebSocket URL | `ws://localhost:3001` |

## Security Considerations

### Production Checklist

- [ ] Use strong, randomly generated `JWT_SECRET` and `API_KEY`
- [ ] Enable HTTPS/WSS (use reverse proxy or load balancer)
- [ ] Implement rate limiting
- [ ] Set up monitoring and alerting
- [ ] Configure container resource limits
- [ ] Use secrets management (AWS Secrets Manager, HashiCorp Vault, etc.)
- [ ] Enable Docker socket security (consider Docker-in-Docker or containerd)
- [ ] Implement sandbox timeout and cleanup
- [ ] Set up log aggregation
- [ ] Configure firewall rules
- [ ] Use network policies (Kubernetes)
- [ ] Enable audit logging

### Rate Limiting

Add rate limiting to the orchestrator:

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/sandbox/', limiter);
```

### Resource Limits

Set Docker container resource limits:

```javascript
HostConfig: {
  Memory: 512 * 1024 * 1024, // 512MB
  MemorySwap: 512 * 1024 * 1024,
  CpuShares: 512,
  CpuPeriod: 100000,
  CpuQuota: 50000
}
```

## Monitoring

### Health Checks

Add health check endpoint to orchestrator:

```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### Metrics

Consider adding Prometheus metrics:

```javascript
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

## Scaling

### Horizontal Scaling

- Run multiple orchestrator instances behind a load balancer
- Use sticky sessions for WebSocket connections
- Consider Redis for shared state (sandbox registry)

### Vertical Scaling

- Increase orchestrator instance size
- Optimize Docker daemon performance
- Use faster storage for containers

## Troubleshooting

### Common Issues

1. **Agent not connecting:**
   - Check `ORCHESTRATOR_HOST` configuration
   - Verify Docker network settings
   - Check firewall rules

2. **WebSocket connection fails:**
   - Ensure reverse proxy supports WebSocket upgrades
   - Check timeout settings
   - Verify SSL/TLS configuration

3. **Container creation fails:**
   - Check Docker daemon is accessible
   - Verify image exists
   - Check resource limits

## Support

For issues and questions, please refer to the main README.md or open an issue.

