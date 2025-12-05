import express from 'express';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import Docker from 'dockerode';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Services and middleware
import pool from './db/index.js';
import { redisClient, connectRedis, setAgentConnection, getAgentConnection, deleteAgentConnection, setSandboxMetadata, getSandboxMetadata, deleteSandboxMetadata, setPortMapping, getPortMapping, deletePortMapping, cleanupSandbox } from './services/redis.js';
import { authenticateApiKey } from './middleware/apiKeyAuth.js';
import { requireAuth } from './services/auth.js';
import { apiLimiter, strictLimiter, securityHeaders, corsOptions } from './middleware/security.js';
import apiKeysRouter from './routes/apiKeys.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';
import createSandboxesRouter from './routes/sandboxes.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { ResourceManager } from './services/resourceManager.js';
import { ContainerOptimizer } from './services/containerOptimizer.js';
import { ContainerPool } from './services/containerPool.js';
import { portAllocator } from './services/portAllocator.js';
import { verifyAgentConnection, verifyClientConnection, WS_CLOSE_CODES } from './services/wsAuth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'sandbox-agent:latest';
const ORCHESTRATOR_HOST = process.env.ORCHESTRATOR_HOST || 'host.docker.internal';

app.use(securityHeaders);
app.use(corsOptions);
app.use(express.json({ limit: '10mb' }));

// Docker client
const docker = new Docker();

// Initialize resource management services
const resourceManager = new ResourceManager(docker, pool);
const containerOptimizer = new ContainerOptimizer(docker);
const containerPool = new ContainerPool(docker, JWT_SECRET);

// Store active WebSocket connections (in-memory for real-time)
const agentConnections = new Map();
const clientConnections = new Map();
const pendingRequests = new Map();

// Routes

// Health check
app.get('/health', async (req, res) => {
  try {
    // Check PostgreSQL
    await pool.query('SELECT 1');
    const postgresHealthy = true;
    
    // Check Redis
    const redisHealthy = redisClient.isReady;
    if (redisHealthy) {
      await redisClient.ping();
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        postgres: postgresHealthy,
        redis: redisHealthy,
        docker: docker.listContainers ? true : false
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'degraded',
      error: error.message
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/keys', apiKeysRouter);
app.use('/api/users', usersRouter);

const sandboxesRouter = createSandboxesRouter({
  docker,
  agentConnections,
  pool,
  JWT_SECRET,
  AGENT_IMAGE,
  ORCHESTRATOR_HOST,
  WS_PORT,
  getSandboxMetadata,
  setSandboxMetadata,
  deleteAgentConnection,
  deletePortMapping,
  cleanupSandbox,
  getPortMapping,
  setPortMapping
});
app.use('/sandbox', sandboxesRouter);

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// WebSocket server (similar to before but with Redis)
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');

  if (pathParts[1] === 'agent' && pathParts[2]) {
    // Agent connection
    const sandboxId = pathParts[2];
    const token = url.searchParams.get('token');

    // Verify agent authentication
    const authResult = await verifyAgentConnection(sandboxId, token, JWT_SECRET);
    if (!authResult.valid) {
      logger.warn(`Agent auth failed for ${sandboxId}: ${authResult.error}`);
      ws.close(WS_CLOSE_CODES.POLICY_VIOLATION, authResult.error);
      return;
    }

    agentConnections.set(sandboxId, ws);
    setAgentConnection(sandboxId, {
      connectedAt: new Date().toISOString(),
      userId: authResult.userId,
      tier: authResult.tier
    }).catch(err => {
      logger.error('Error storing agent connection in Redis:', err);
    });

    logger.info(`Agent connected: ${sandboxId}`);

    ws.on('message', (message) => {
      handleAgentMessage(sandboxId, message);
    });

    ws.on('close', () => {
      agentConnections.delete(sandboxId);
      deleteAgentConnection(sandboxId).catch(err => {
        logger.error('Error deleting agent connection from Redis:', err);
      });
      logger.info(`Agent disconnected: ${sandboxId}`);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error for agent ${sandboxId}:`, error);
    });
  } else if (pathParts[1] === 'client' && pathParts[2]) {
    // Client connection with authentication
    const sandboxId = pathParts[2];
    const apiKey = url.searchParams.get('apiKey') || req.headers['x-api-key'];
    const token = url.searchParams.get('token');

    // Verify client authentication
    const authResult = await verifyClientConnection(sandboxId, apiKey, token, JWT_SECRET);
    if (!authResult.valid) {
      logger.warn(`Client auth failed for ${sandboxId}: ${authResult.error}`);
      ws.close(WS_CLOSE_CODES.POLICY_VIOLATION, authResult.error);
      return;
    }

    // Store auth info on the websocket for later use
    ws.authInfo = authResult;

    if (!clientConnections.has(sandboxId)) {
      clientConnections.set(sandboxId, new Set());
    }
    clientConnections.get(sandboxId).add(ws);

    logger.info(`Client connected: ${sandboxId} (method: ${authResult.method})`);

    ws.on('message', async (message) => {
      let parsedData = null;
      try {
        parsedData = JSON.parse(message.toString());
        const agentWs = agentConnections.get(sandboxId);

        if (!agentWs || agentWs.readyState !== 1) {
          ws.send(JSON.stringify({
            id: parsedData.id,
            type: 'error',
            error: 'Agent not connected'
          }));
          return;
        }

        agentWs.send(JSON.stringify(parsedData));

        if (!pendingRequests.has(sandboxId)) {
          pendingRequests.set(sandboxId, new Map());
        }
        pendingRequests.get(sandboxId).set(parsedData.id, ws);
      } catch (error) {
        logger.error('Error handling client message:', error);
        ws.send(JSON.stringify({
          id: parsedData?.id || null,
          type: 'error',
          error: error.message
        }));
      }
    });

    ws.on('close', () => {
      if (clientConnections.has(sandboxId)) {
        clientConnections.get(sandboxId).delete(ws);
      }
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error for client ${sandboxId}:`, error);
    });
  } else {
    // Unknown path
    ws.close(WS_CLOSE_CODES.UNSUPPORTED, 'Invalid WebSocket path');
  }
});

function handleAgentMessage(sandboxId, message) {
  try {
    const data = JSON.parse(message.toString());
    const requests = pendingRequests.get(sandboxId);
    
    if (requests && requests.has(data.id)) {
      const clientWs = requests.get(data.id);
      if (clientWs && clientWs.readyState === 1) {
        clientWs.send(message.toString());
        requests.delete(data.id);
      }
    }
  } catch (error) {
    logger.error('Error routing agent message:', error);
  }
}

// Start HTTP server
async function startServer() {
  console.log('\n=== STARTING SERVER ===');
  console.log(`Port: ${PORT}`);
  console.log(`WebSocket Port: ${WS_PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`LOG_LEVEL: ${process.env.LOG_LEVEL || 'DEBUG'}`);
  
  try {
    // Connect to Redis
    console.log('Connecting to Redis...');
    await connectRedis();
    logger.info('Redis connected');
    console.log('✓ Redis connected');

    // Test database connection
    console.log('Testing database connection...');
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');
    console.log('✓ PostgreSQL connected');

    // Pre-pull and optimize container images
    console.log('Optimizing container images...');
    logger.info('Optimizing container images...');
    await containerOptimizer.prePullImages([AGENT_IMAGE]);
    console.log('✓ Images optimized');

    // Initialize port allocator
    console.log('Initializing port allocator...');
    await portAllocator.initialize();
    console.log('✓ Port allocator initialized');

    // Initialize container pool (if enabled)
    console.log('Initializing container pool...');
    await containerPool.initialize();
    console.log('✓ Container pool initialized');

    // Start resource monitoring
    console.log('Starting resource management services...');
    resourceManager.startMonitoring();
    containerOptimizer.startOptimizationTasks();

    logger.info('Resource management services started');
    console.log('✓ Resource management services started');

    // Start HTTP server
    console.log(`\n=== SERVER STARTING ===`);
    app.listen(PORT, () => {
      logger.info(`Orchestrator API listening on http://localhost:${PORT}`);
      logger.info(`WebSocket server listening on ws://localhost:${WS_PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info('🚀 Orchestrator API ready with enhanced resource management');
      
      console.log(`\n✓ Orchestrator API listening on http://localhost:${PORT}`);
      console.log(`✓ WebSocket server listening on ws://localhost:${WS_PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('🚀 Orchestrator API ready with enhanced resource management\n');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);

  try {
    // Close WebSocket connections
    agentConnections.forEach((ws) => {
      try {
        ws.close();
      } catch (e) {
        logger.warn('Error closing agent connection:', e);
      }
    });
    clientConnections.forEach((connections) => {
      connections.forEach((ws) => {
        try {
          ws.close();
        } catch (e) {
          logger.warn('Error closing client connection:', e);
        }
      });
    });

    // Shutdown container pool
    await containerPool.shutdown();
    logger.info('Container pool shutdown');

    // Close Redis connection
    if (redisClient.isReady) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }

    // Close database connection
    await pool.end();
    logger.info('PostgreSQL connection closed');

    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

