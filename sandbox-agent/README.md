# Sandbox Agent

The sandbox agent runs inside each Docker container and handles RPC commands from the orchestrator.

## Features

- WebSocket connection to orchestrator
- Command execution via child processes
- File read/write operations
- Automatic reconnection on disconnect
- Error handling and reporting

## Installation

```bash
npm install
```

## Environment Variables

- `ORCHESTRATOR_URL` - WebSocket URL of the orchestrator (default: `ws://host.docker.internal:3001`)
- `AGENT_TOKEN` - JWT token for authentication (provided by orchestrator)
- `SANDBOX_ID` - Unique sandbox identifier (provided by orchestrator)

## Running

The agent is designed to run inside a Docker container. It will:
1. Connect to the orchestrator via WebSocket
2. Authenticate using the JWT token
3. Listen for RPC commands
4. Execute commands and return results

## RPC Commands

### exec
Execute a command in the container.

**Request:**
```json
{
  "id": "uuid",
  "type": "exec",
  "cmd": "node",
  "args": ["--version"]
}
```

**Response:**
```json
{
  "id": "uuid",
  "type": "execResponse",
  "stdout": "v20.0.0\n",
  "stderr": "",
  "exitCode": 0
}
```

### write
Write a file to the filesystem.

**Request:**
```json
{
  "id": "uuid",
  "type": "write",
  "path": "hello.js",
  "content": "console.log('Hello');"
}
```

**Response:**
```json
{
  "id": "uuid",
  "type": "writeResponse",
  "success": true,
  "path": "hello.js"
}
```

### read
Read a file from the filesystem.

**Request:**
```json
{
  "id": "uuid",
  "type": "read",
  "path": "hello.js"
}
```

**Response:**
```json
{
  "id": "uuid",
  "type": "readResponse",
  "content": "console.log('Hello');",
  "path": "hello.js"
}
```

## Error Handling

Errors are returned in the response:

```json
{
  "id": "uuid",
  "type": "error",
  "error": "Error message"
}
```

