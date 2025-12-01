# Quick Start Guide

## Prerequisites

- Node.js 20+
- Docker
- npm

## Step 1: Setup

Run the setup script to install dependencies and build Docker images:

```bash
./setup.sh
```

Or manually:

```bash
# Install dependencies
cd orchestrator-api && npm install && cd ..
cd sandbox-agent && npm install && cd ..
cd sdk && npm install && cd ..

# Build Docker images
cd docker && ./build.sh && cd ..
```

## Step 2: Configure

Create `orchestrator-api/.env`:

```env
PORT=3000
WS_PORT=3001
JWT_SECRET=your-secret-key-change-in-production
API_KEY=test-api-key
AGENT_IMAGE=sandbox-agent:latest
ORCHESTRATOR_HOST=host.docker.internal
```

**Note for Linux users:** If `host.docker.internal` doesn't work, you may need to:
1. Use your host machine's IP address instead
2. Or add `--add-host=host.docker.internal:host-gateway` when running Docker containers

## Step 3: Start Orchestrator

```bash
cd orchestrator-api
npm start
```

You should see:
```
Orchestrator API listening on http://localhost:3000
WebSocket server listening on ws://localhost:3001
```

## Step 4: Run Example

In a new terminal:

```bash
cd example
export INSIEN_API_KEY=test-api-key
node index.js
```

That's it! The SDK automatically handles creating the sandbox, connecting, and managing everything. You just need to provide your API key.

## Troubleshooting

### Agent not connecting

1. Check if the Docker container is running:
   ```bash
   docker ps
   ```

2. Check container logs:
   ```bash
   docker logs sandbox-<id>
   ```

3. Verify `ORCHESTRATOR_HOST` is correct for your system

### WebSocket connection failed

1. Ensure the orchestrator is running
2. Check firewall settings
3. Verify ports 3000 and 3001 are not in use

### Docker permission errors

On Linux, you may need to add your user to the docker group:
```bash
sudo usermod -aG docker $USER
```
Then log out and back in.

