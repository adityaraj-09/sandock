# Production Architecture

## Overview

The Insien Sandbox system uses a **unified orchestrator API** that handles both:
1. **Client-facing operations** (auth, API keys)
2. **Sandbox management** (create, destroy, expose ports)

This simplifies deployment while maintaining clear separation of concerns.

## Components

### Orchestrator API (`orchestrator-api/`)

Single Express.js service with:

#### Routes
- `/api/keys/*` - API key management (requires Clerk auth)
- `/sandbox/*` - Sandbox operations (requires API key)
- `/health` - Health check

#### Services
- `services/auth.js` - Clerk authentication
- `services/apiKeys.js` - API key generation and validation
- `services/redis.js` - Redis connection management

#### Database
- PostgreSQL for persistent data (users, API keys, sandboxes)
- Redis for ephemeral data (agent connections, port mappings)

#### Security
- Clerk for user authentication
- API keys for service access
- Rate limiting
- Helmet security headers
- CORS protection
- Input validation (Zod)

## Data Flow

### User Registration/Login
1. User authenticates with Clerk (frontend)
2. Frontend gets Clerk session token
3. Backend verifies token and creates/updates user in PostgreSQL

### API Key Creation
1. User calls `POST /api/keys` with Clerk token
2. System generates API key (hashed with bcrypt)
3. Key stored in PostgreSQL
4. Full key returned once (then only prefix shown)

### Sandbox Creation
1. Client calls `POST /sandbox/create` with API key
2. API key validated against PostgreSQL
3. Docker container created
4. Sandbox metadata stored in PostgreSQL + Redis
5. Agent connects via WebSocket

### Agent Communication
1. Agent connects to WebSocket with JWT token
2. Connection stored in Redis + in-memory Map
3. Client sends RPC via WebSocket
4. Orchestrator routes to agent
5. Agent responds, routed back to client

## Storage Strategy

### PostgreSQL (Persistent)
- Users
- API Keys (hashed)
- Sandbox records
- Audit trail

### Redis (Ephemeral)
- Agent connection state
- Sandbox metadata (cached)
- Port mappings
- Pending RPC requests

### In-Memory (Real-time)
- Active WebSocket connections (for routing)
- Pending request mappings

## Security Layers

1. **Clerk Authentication** - User identity
2. **API Key Validation** - Service access
3. **JWT Tokens** - Agent authentication
4. **Rate Limiting** - Abuse prevention
5. **Input Validation** - Data integrity
6. **Database Queries** - User isolation

## Deployment Options

### Option 1: Single Service (Recommended)
- One orchestrator API handles everything
- Simpler deployment
- Easier to maintain
- Can scale horizontally

### Option 2: Split Services
- Auth service (Clerk + API keys)
- Orchestrator service (sandbox management)
- More complex but better separation

## Next Steps

1. Review the new code structure
2. Install dependencies: `npm install`
3. Set up PostgreSQL and Redis
4. Run migrations: `npm run migrate`
5. Configure environment variables
6. Test the API endpoints

