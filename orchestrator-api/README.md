# Orchestrator API

The orchestrator API manages the lifecycle of sandbox instances, handles Docker container creation/destruction, and routes WebSocket messages between SDK clients and sandbox agents.

## Features

- REST API for sandbox management
- WebSocket server for agent and client connections
- Docker container orchestration
- JWT-based authentication for agents
- API key authentication for REST endpoints
- Message routing between clients and agents

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
PORT=3000
WS_PORT=3001
JWT_SECRET=your-secret-key-change-in-production
API_KEY=test-api-key
AGENT_IMAGE=sandbox-agent:latest
```

## Running

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## API Endpoints

### POST /sandbox/create
Creates a new sandbox instance.

**Headers:**
- `X-API-Key: your-api-key`

**Response:**
```json
{
  "sandboxId": "uuid",
  "agentUrl": "ws://localhost:3001/agent/uuid"
}
```

### POST /sandbox/:id/destroy
Destroys a sandbox instance.

**Headers:**
- `X-API-Key: your-api-key`

### GET /sandbox/:id/status
Gets sandbox status.

**Headers:**
- `X-API-Key: your-api-key`

## WebSocket Endpoints

### ws://localhost:3001/agent/:sandboxId?token=JWT_TOKEN
Agent connection endpoint. Agents connect here to receive RPC commands.

### ws://localhost:3001/client/:sandboxId
Client connection endpoint. SDK clients connect here to send RPC commands.

## Architecture

The orchestrator maintains:
- A map of active sandboxes
- Agent WebSocket connections
- Client WebSocket connections
- Pending RPC request routing

When a client sends an RPC request:
1. Request is forwarded to the agent WebSocket
2. Request ID is stored for response routing
3. Agent response is routed back to the originating client

