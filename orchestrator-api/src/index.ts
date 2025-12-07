import express from 'express';
import type { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import Docker from 'dockerode';
import dotenv from 'dotenv';
import type { IncomingMessage } from 'http';

import pool from './db/index.js';
import {
  redisClient,
  connectRedis,
  setAgentConnection,
  deleteAgentConnection,
  getSandboxMetadata,
  setSandboxMetadata,
  deletePortMapping,
  cleanupSandbox,
  getPortMapping,
  setPortMapping
} from './services/redis.js';
import { securityHeaders, corsOptions } from './middleware/security.js';
import apiKeysRouter from './routes/apiKeys.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';
import createSandboxesRouter from './routes/sandboxes.js';
import templatesRouter from './routes/templates.js';
import createSettingsRouter from './routes/settings.js';
import createImagesRouter from './routes/images.js';
import createStorageRouter from './routes/storage.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { ResourceManager } from './services/resourceManager.js';
import { ContainerOptimizer } from './services/containerOptimizer.js';
import { ContainerPool } from './services/containerPool.js';
import { portAllocator } from './services/portAllocator.js';
import { verifyAgentConnection, verifyClientConnection, WS_CLOSE_CODES } from './services/wsAuth.js';
import type { AuthenticatedWebSocket, AgentMessage, ClientMessage } from './types/index.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '3001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'sandbox-agent:latest';
const ORCHESTRATOR_HOST = process.env.ORCHESTRATOR_HOST || 'host.docker.internal';

app.use(securityHeaders);
app.use(corsOptions);
app.use(express.json({ limit: '10mb' }));

const docker = new Docker();

const resourceManager = new ResourceManager(docker, pool);
const containerOptimizer = new ContainerOptimizer(docker);
const containerPool = new ContainerPool(docker, JWT_SECRET);

const agentConnections = new Map<string, WebSocket>();
const clientConnections = new Map<string, Set<AuthenticatedWebSocket>>();
const pendingRequests = new Map<string, Map<string, AuthenticatedWebSocket>>();

app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    const postgresHealthy = true;

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
        docker: true
      }
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'degraded',
      error: err.message
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/keys', apiKeysRouter);
app.use('/api/users', usersRouter);
app.use('/api/templates', templatesRouter);

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

const settingsRouter = createSettingsRouter({ agentConnections });
app.use('/api/settings', settingsRouter);

const imagesRouter = createImagesRouter({ docker });
app.use('/api/images', imagesRouter);

const storageRouter = createStorageRouter({ docker });
app.use('/api/storage', storageRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');

  if (pathParts[1] === 'agent' && pathParts[2]) {
    const sandboxId = pathParts[2];
    const token = url.searchParams.get('token');

    const authResult = await verifyAgentConnection(sandboxId, token, JWT_SECRET);
    if (!authResult.valid) {
      logger.warn(`Agent auth failed for ${sandboxId}: ${authResult.error}`);
      ws.close(WS_CLOSE_CODES.POLICY_VIOLATION, authResult.error);
      return;
    }

    agentConnections.set(sandboxId, ws);
    setAgentConnection(sandboxId, {
      connectedAt: new Date().toISOString(),
      userId: authResult.userId || '',
      tier: authResult.tier || 'free'
    }).catch((err) => {
      logger.error('Error storing agent connection in Redis:', err);
    });

    logger.info(`Agent connected: ${sandboxId}`);

    ws.on('message', (message: Buffer) => {
      handleAgentMessage(sandboxId, message);
    });

    ws.on('close', () => {
      agentConnections.delete(sandboxId);
      deleteAgentConnection(sandboxId).catch((err) => {
        logger.error('Error deleting agent connection from Redis:', err);
      });
      logger.info(`Agent disconnected: ${sandboxId}`);
    });

    ws.on('error', (error: Error) => {
      logger.error(`WebSocket error for agent ${sandboxId}:`, error);
    });
  } else if (pathParts[1] === 'client' && pathParts[2]) {
    const sandboxId = pathParts[2];
    const apiKey = url.searchParams.get('apiKey') || (req.headers['x-api-key'] as string);
    const token = url.searchParams.get('token');

    const authResult = await verifyClientConnection(sandboxId, apiKey, token, JWT_SECRET);
    if (!authResult.valid) {
      logger.warn(`Client auth failed for ${sandboxId}: ${authResult.error}`);
      ws.close(WS_CLOSE_CODES.POLICY_VIOLATION, authResult.error);
      return;
    }

    const authenticatedWs = ws as AuthenticatedWebSocket;
    authenticatedWs.authInfo = authResult;

    if (!clientConnections.has(sandboxId)) {
      clientConnections.set(sandboxId, new Set());
    }
    clientConnections.get(sandboxId)!.add(authenticatedWs);

    logger.info(`Client connected: ${sandboxId} (method: ${authResult.method})`);

    ws.on('message', async (message: Buffer) => {
      let parsedData: ClientMessage | null = null;
      try {
        parsedData = JSON.parse(message.toString()) as ClientMessage;
        const agentWs = agentConnections.get(sandboxId);

        if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
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
        pendingRequests.get(sandboxId)!.set(parsedData.id, authenticatedWs);
      } catch (error) {
        const err = error as Error;
        logger.error('Error handling client message:', error);
        ws.send(JSON.stringify({
          id: parsedData?.id || null,
          type: 'error',
          error: err.message
        }));
      }
    });

    ws.on('close', () => {
      if (clientConnections.has(sandboxId)) {
        clientConnections.get(sandboxId)!.delete(authenticatedWs);
      }
    });

    ws.on('error', (error: Error) => {
      logger.error(`WebSocket error for client ${sandboxId}:`, error);
    });
  } else {
    ws.close(WS_CLOSE_CODES.UNSUPPORTED, 'Invalid WebSocket path');
  }
});

function handleAgentMessage(sandboxId: string, message: Buffer): void {
  try {
    const data = JSON.parse(message.toString()) as AgentMessage;
    const requests = pendingRequests.get(sandboxId);

    if (requests && requests.has(data.id)) {
      const clientWs = requests.get(data.id);
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(message.toString());
        requests.delete(data.id);
      }
    }
  } catch (error) {
    logger.error('Error routing agent message:', error);
  }
}

async function startServer(): Promise<void> {
  console.log('\n=== STARTING SERVER ===');
  console.log(`Port: ${PORT}`);
  console.log(`WebSocket Port: ${WS_PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`LOG_LEVEL: ${process.env.LOG_LEVEL || 'DEBUG'}`);

  try {
    console.log('Connecting to Redis...');
    await connectRedis();
    logger.info('Redis connected');
    console.log('✓ Redis connected');

    console.log('Testing database connection...');
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');
    console.log('✓ PostgreSQL connected');

    console.log('Optimizing container images...');
    logger.info('Optimizing container images...');
    await containerOptimizer.prePullImages([AGENT_IMAGE]);
    console.log('✓ Images optimized');

    console.log('Initializing port allocator...');
    await portAllocator.initialize();
    console.log('✓ Port allocator initialized');

    console.log('Initializing container pool...');
    await containerPool.initialize();
    console.log('✓ Container pool initialized');

    console.log('Starting resource management services...');
    resourceManager.startMonitoring();
    containerOptimizer.startOptimizationTasks();

    logger.info('Resource management services started');
    console.log('✓ Resource management services started');

    console.log('\n=== SERVER STARTING ===');
    app.listen(PORT, () => {
      logger.info(`Orchestrator API listening on http://localhost:${PORT}`);
      logger.info(`WebSocket server listening on ws://localhost:${WS_PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info('Orchestrator API ready with enhanced resource management');

      console.log(`\n✓ Orchestrator API listening on http://localhost:${PORT}`);
      console.log(`✓ WebSocket server listening on ws://localhost:${WS_PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('Orchestrator API ready with enhanced resource management\n');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully...`);

  try {
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

    await containerPool.shutdown();
    logger.info('Container pool shutdown');

    if (redisClient.isReady) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }

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

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});
