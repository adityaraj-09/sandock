# Production Setup Guide

This guide covers setting up the Insien Sandbox orchestrator API for production with Clerk authentication, PostgreSQL, and Redis.

## Architecture

The orchestrator API combines:
- **Client-facing API** - User authentication, API key management
- **Sandbox Management API** - Create, destroy, manage sandboxes
- **WebSocket Server** - Real-time communication with agents

All in one service for simplicity, but can be split if needed for scaling.

## Prerequisites

1. **PostgreSQL** (v14+)
2. **Redis** (v6+)
3. **Docker** (for running sandbox containers)
4. **Clerk Account** (for authentication)

## Setup Steps

### 1. Database Setup

```bash
# Create database
createdb insien_sandbox

# Or with PostgreSQL client
psql -U postgres
CREATE DATABASE insien_sandbox;
```

### 2. Run Migrations

```bash
cd orchestrator-api
npm install
npm run migrate
```

### 3. Configure Environment

Copy `.env.production.example` to `.env` and fill in:

```bash
cp .env.production.example .env
```

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `CLERK_SECRET_KEY` - From Clerk dashboard
- `JWT_SECRET` - Generate with `openssl rand -base64 32`

### 4. Start Services

```bash
# Start PostgreSQL (if not running)
# Start Redis (if not running)
redis-server

# Start orchestrator
npm start
```

## API Endpoints

### Authentication Required (Clerk Bearer Token)

#### POST /api/keys
Create a new API key.

**Headers:**
```
Authorization: Bearer <clerk_session_token>
```

**Body:**
```json
{
  "name": "My API Key",
  "expiresInDays": 30  // optional
}
```

**Response:**
```json
{
  "success": true,
  "apiKey": {
    "id": "uuid",
    "key": "isk_xxxxxxxxxxxx",  // Only shown once!
    "prefix": "isk_xxxxxxxx",
    "name": "My API Key",
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-01-31T00:00:00Z"
  }
}
```

#### GET /api/keys
List all API keys for the authenticated user.

#### DELETE /api/keys/:id
Revoke an API key.

### API Key Required (X-API-Key header)

#### POST /sandbox/create
Create a new sandbox.

**Headers:**
```
X-API-Key: isk_xxxxxxxxxxxx
```

#### POST /sandbox/:id/destroy
Destroy a sandbox.

#### GET /sandbox/:id/status
Get sandbox status.

#### POST /sandbox/:id/expose
Expose a container port.

#### GET /sandbox/:id/ports
Get all exposed ports.

## Security Features

1. **Clerk Authentication** - Secure user authentication
2. **API Key Management** - Users create and manage their own API keys
3. **Rate Limiting** - Prevents abuse
4. **Helmet** - Security headers
5. **CORS** - Configurable origins
6. **Input Validation** - Zod schemas
7. **Database-backed** - All sandboxes tracked in PostgreSQL
8. **Redis** - Fast connection state management

## Production Deployment

### Docker Compose

See `docker/docker-compose.prod.yml` for a complete setup including:
- Orchestrator API
- PostgreSQL
- Redis

### Environment Variables

All sensitive values should be set via environment variables or secrets management (AWS Secrets Manager, HashiCorp Vault, etc.).

### Monitoring

- Health endpoint: `GET /health`
- Logs: Use structured logging (consider Winston or Pino)
- Metrics: Add Prometheus metrics if needed

## Scaling Considerations

- **Horizontal Scaling**: Run multiple orchestrator instances behind a load balancer
- **Sticky Sessions**: Required for WebSocket connections
- **Redis Cluster**: For high availability
- **PostgreSQL Replication**: For read scaling
- **Docker Socket**: Consider Docker-in-Docker or containerd API

## Next Steps

1. Set up Clerk account and get API key
2. Configure PostgreSQL and Redis
3. Run migrations
4. Start the service
5. Test API key creation
6. Test sandbox creation

