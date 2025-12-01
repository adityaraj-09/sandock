# Insien Sandbox

A complete code-sandbox backend and SDK system that allows users to create ephemeral sandbox instances (Docker containers) with an internal Agent that handles command execution, file operations, and more.

## Architecture

The system consists of four main components:

1. **Orchestrator API** - REST API and WebSocket server that manages sandbox lifecycle
2. **Sandbox Agent** - Runs inside each container, connects via WebSocket, handles RPC commands
3. **SDK** - JavaScript SDK for interacting with sandboxes
4. **Docker** - Container images for sandbox instances

## Project Structure

```
.
├── orchestrator-api/     # REST API + WebSocket server
├── sandbox-agent/        # Agent that runs in containers
├── sdk/                  # JavaScript SDK
├── example/              # Example usage
└── docker/               # Dockerfiles and build scripts
```

## Quick Start

### First Time Setup

1. **Install Prerequisites:**
   - Node.js 20+ ([Install Node.js](https://nodejs.org/))
   - Docker ([Install Docker](https://docs.docker.com/get-docker/))
   
   See [INSTALL.md](./INSTALL.md) for detailed installation instructions.

2. **Run Setup:**
   ```bash
   ./setup.sh
   ```

3. **Start the System:**
   ```bash
   ./start.sh
   ```

See [RUNNING.md](./RUNNING.md) for detailed instructions.

### Local Development

```bash
# 1. Setup
./setup.sh

# 2. Configure orchestrator
cd orchestrator-api
cp .env.example .env
# Edit .env with your settings

# 3. Start orchestrator
npm start

# 4. Run example (in another terminal)
cd example
export INSIEN_API_KEY=test-api-key
node index.js
```

### Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment options including:
- Docker Compose
- Kubernetes
- Cloud platforms (AWS, GCP, DigitalOcean)

## Configuration

### Orchestrator Environment Variables

Create `orchestrator-api/.env`:

```env
PORT=3000
WS_PORT=3001
JWT_SECRET=your-secret-key-change-in-production
API_KEY=test-api-key
AGENT_IMAGE=sandbox-agent:latest
```

### Docker Network Configuration

The orchestrator uses `host.docker.internal` to connect containers back to the orchestrator. On Linux, you may need to add `--add-host=host.docker.internal:host-gateway` to Docker commands or use the host's IP address.

## SDK Usage

Simple API - just provide your API key and start using it!

```javascript
import { Sandbox } from '@insien/sandbox';

// Initialize with just your API key
const sandbox = new Sandbox({
  apiKey: 'your-api-key'
});

// Write a file
await sandbox.writeFile('hello.js', "console.log('Hello!');");

// Run a command
const result = await sandbox.runCommand('node', ['--version']);
console.log(result.stdout);

// Read a file
const file = await sandbox.getFile('hello.js');
console.log(file.content);

// Get terminal output
const output = await sandbox.runCommand('ls', ['-la']);
console.log(output.stdout);

// Cleanup when done
await sandbox.destroy();
```

**Note:** The sandbox is automatically created on first use. No need to call `create()` manually!

## API Reference

### Orchestrator REST API

#### POST /sandbox/create
Create a new sandbox instance.

**Headers:**
- `X-API-Key: your-api-key`

**Response:**
```json
{
  "sandboxId": "uuid",
  "agentUrl": "ws://localhost:3001/agent/uuid"
}
```

#### POST /sandbox/:id/destroy
Destroy a sandbox instance.

**Headers:**
- `X-API-Key: your-api-key`

**Response:**
```json
{
  "success": true,
  "sandboxId": "uuid"
}
```

#### GET /sandbox/:id/status
Get sandbox status.

**Headers:**
- `X-API-Key: your-api-key`

**Response:**
```json
{
  "sandboxId": "uuid",
  "connected": true,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### RPC Protocol

The SDK and Agent communicate via WebSocket using a simple JSON-RPC protocol:

#### Exec Command
```json
{
  "id": "uuid",
  "type": "exec",
  "cmd": "node",
  "args": ["--version"]
}
```

Response:
```json
{
  "id": "uuid",
  "type": "execResponse",
  "stdout": "v20.0.0\n",
  "stderr": "",
  "exitCode": 0
}
```

#### Write File
```json
{
  "id": "uuid",
  "type": "write",
  "path": "hello.js",
  "content": "console.log('Hello');"
}
```

Response:
```json
{
  "id": "uuid",
  "type": "writeResponse",
  "success": true,
  "path": "hello.js"
}
```

#### Read File
```json
{
  "id": "uuid",
  "type": "read",
  "path": "hello.js"
}
```

Response:
```json
{
  "id": "uuid",
  "type": "readResponse",
  "content": "console.log('Hello');",
  "path": "hello.js"
}
```

## Development

### Prerequisites

- Node.js 20+
- Docker
- npm or yarn

### Running Locally

1. Install dependencies in each directory:
   ```bash
   cd orchestrator-api && npm install
   cd ../sandbox-agent && npm install
   cd ../sdk && npm install
   ```

2. Build the agent Docker image:
   ```bash
   cd docker && ./build.sh
   ```

3. Start the orchestrator:
   ```bash
   cd orchestrator-api && npm start
   ```

4. Run the example:
   ```bash
   cd example && node index.js
   ```

## Security Considerations

- Change the default `JWT_SECRET` and `API_KEY` in production
- Use HTTPS/WSS in production
- Implement rate limiting
- Add input validation and sanitization
- Consider container resource limits
- Implement proper authentication and authorization

## License

MIT

