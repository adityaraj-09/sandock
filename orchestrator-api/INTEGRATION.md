# Integration Guide

This guide explains how to integrate the new production-ready code into your existing orchestrator API.

## Step 1: Replace index.js

The new production-ready code is in `src/index.new.js`. To integrate:

```bash
cd orchestrator-api
mv src/index.js src/index.old.js
mv src/index.new.js src/index.js
```

## Step 2: Install Dependencies

```bash
npm install
```

This will install:
- `jsonwebtoken` - JWT authentication
- `pg` - PostgreSQL client
- `redis` - Redis client
- `express-rate-limit` - Rate limiting
- `helmet` - Security headers
- `cors` - CORS middleware
- `bcrypt` - Password hashing
- `zod` - Schema validation

## Step 3: Set Up Database

### Create Database

```bash
createdb insien_sandbox
```

### Run Migrations

```bash
npm run migrate
```

This will create:
- `users` table with full profile fields
- `api_keys` table
- `sandboxes` table

### If You Have Existing Data

Run the migration script to add new user fields:

```bash
psql -d insien_sandbox -f src/db/migrations/001_add_user_fields.sql
```

## Step 4: Set Up Redis

```bash
# Install Redis (macOS)
brew install redis

# Start Redis
redis-server

# Or use Docker
docker run -d -p 6379:6379 redis:7-alpine
```

## Step 5: Configure Environment

Copy and configure `.env`:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
- `JWT_SECRET` - Generate with `openssl rand -base64 32` (required for JWT authentication)

## Step 6: Test the Integration

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Check health:**
   ```bash
   curl http://localhost:3000/health
   ```

3. **Register a new user:**
   ```bash
   curl -X POST \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com", "password": "securepassword123", "firstName": "John", "lastName": "Doe"}' \
     http://localhost:3000/api/auth/register
   ```

4. **Login:**
   ```bash
   curl -X POST \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com", "password": "securepassword123"}' \
     http://localhost:3000/api/auth/login
   ```
   Save the `token` from the response.

5. **Test JWT auth:**
   ```bash
   curl -H "Authorization: Bearer <jwt_token>" http://localhost:3000/api/users/me
   ```

6. **Create API key:**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer <jwt_token>" \
     -H "Content-Type: application/json" \
     -d '{"name": "Test Key"}' \
     http://localhost:3000/api/keys
   ```

## Key Changes

### Database-Backed Storage
- Users, API keys, and sandboxes stored in PostgreSQL
- Redis used for ephemeral data (connections, metadata cache)

### Enhanced User Profile
- User registration and login with email/password
- JWT-based authentication
- User profile endpoints at `/api/users/me`
- Users can update their profile fields

### Production Features
- Structured logging
- Error handling middleware
- Rate limiting
- Security headers
- Graceful shutdown
- Health checks

### API Key Management
- Users create their own API keys
- Keys are hashed and stored securely
- Can revoke keys
- Track last used time

## Migration from Old Code

The old code used:
- In-memory Maps for storage
- Simple API key authentication
- No user management

The new code:
- Uses PostgreSQL + Redis
- JWT-based authentication (email/password)
- API keys per user
- Full user profiles

## Next Steps

1. Configure PostgreSQL and Redis
2. Run migrations (including the JWT migration)
3. Register a new user account
4. Test authentication flow (login/register)
5. Create API keys
6. Test sandbox creation with new API keys

