import express from 'express';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import Docker from 'dockerode';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const API_KEY = process.env.API_KEY || 'test-api-key';
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'sandbox-agent:latest';
const ORCHESTRATOR_HOST = process.env.ORCHESTRATOR_HOST || 'host.docker.internal';

app.use(express.json());

// Docker client
const docker = new Docker();

// Store active sandboxes: sandboxId -> { container, ws, createdAt, exposedPorts }
const sandboxes = new Map();

// Store agent connections: sandboxId -> WebSocket
const agentConnections = new Map();

// Port mapping: hostPort -> sandboxId
const portMappings = new Map();
let nextAvailablePort = 30000; // Start from 30000 to avoid conflicts

// Middleware for API key authentication
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};


app.post('/sandbox/create', authenticateApiKey, async (req, res) => {
  try {
    const sandboxId = uuidv4();
    const containerName = `sandbox-${sandboxId}`;

    // Create JWT token for agent authentication
    const agentToken = jwt.sign(
      { sandboxId, type: 'agent' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Create container with agent
    const hostConfig = {
      NetworkMode: 'bridge',
      AutoRemove: true
    };

    // Add host.docker.internal mapping for Linux compatibility
    if (ORCHESTRATOR_HOST === 'host.docker.internal') {
      hostConfig.ExtraHosts = ['host.docker.internal:host-gateway'];
    }

    const container = await docker.createContainer({
      Image: AGENT_IMAGE,
      name: containerName,
      Env: [
        `ORCHESTRATOR_URL=ws://${ORCHESTRATOR_HOST}:${WS_PORT}`,
        `AGENT_TOKEN=${agentToken}`,
        `SANDBOX_ID=${sandboxId}`
      ],
      HostConfig: hostConfig,
      Tty: false,
      OpenStdin: true,
      StdinOnce: false
    });

    await container.start();

    sandboxes.set(sandboxId, {
      container,
      ws: null,
      createdAt: new Date(),
      sandboxId,
      exposedPorts: {}
    });

    res.json({
      sandboxId,
      agentUrl: `ws://localhost:${WS_PORT}/agent/${sandboxId}`
    });
  } catch (error) {
    console.error('Error creating sandbox:', error);
    res.status(500).json({ error: error.message });
  }
});

// Destroy a sandbox
app.post('/sandbox/:id/destroy', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const sandbox = sandboxes.get(id);

    if (!sandbox) {
      return res.status(404).json({ error: 'Sandbox not found' });
    }

    // Close WebSocket connection if exists
    if (sandbox.ws) {
      sandbox.ws.close();
      agentConnections.delete(id);
    }

    // Stop and remove container
    try {
      const container = docker.getContainer(sandbox.container.id);
      await container.stop();
      await container.remove();
    } catch (err) {
      console.error('Error removing container:', err);
    }

    sandboxes.delete(id);

    res.json({ success: true, sandboxId: id });
  } catch (error) {
    console.error('Error destroying sandbox:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get sandbox status
app.get('/sandbox/:id/status', authenticateApiKey, (req, res) => {
  const { id } = req.params;
  const sandbox = sandboxes.get(id);

  if (!sandbox) {
    return res.status(404).json({ error: 'Sandbox not found' });
  }

  res.json({
    sandboxId: id,
    connected: !!sandbox.ws,
    createdAt: sandbox.createdAt
  });
});

// Expose a port from sandbox container
app.post('/sandbox/:id/expose', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { containerPort } = req.body;
    
    if (!containerPort) {
      return res.status(400).json({ error: 'containerPort is required' });
    }

    const sandbox = sandboxes.get(id);
    if (!sandbox) {
      return res.status(404).json({ error: 'Sandbox not found' });
    }

    // Check if port is already exposed
    if (sandbox.exposedPorts[containerPort]) {
      const hostPort = sandbox.exposedPorts[containerPort];
      return res.json({
        sandboxId: id,
        containerPort: parseInt(containerPort),
        hostPort,
        url: `http://localhost:${hostPort}`
      });
    }

    // Find available host port
    let hostPort = nextAvailablePort;
    while (portMappings.has(hostPort)) {
      hostPort++;
    }
    nextAvailablePort = hostPort + 1;

    // Get container and inspect current state
    const container = docker.getContainer(sandbox.container.id);
    let containerInfo;
    
    try {
      containerInfo = await container.inspect();
    } catch (error) {
      // Container might not exist, try to get fresh info
      throw new Error('Container not found');
    }
    
    // Stop container if running
    try {
      const containerState = containerInfo.State;
      if (containerState.Running) {
        await container.stop();
        // Wait for container to stop
        let attempts = 0;
        while (attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          try {
            const state = await container.inspect();
            if (!state.State.Running) break;
          } catch (e) {
            break; // Container might be removed
          }
          attempts++;
        }
      }
    } catch (error) {
      // Container might already be stopped
      if (!error.message.includes('not running') && !error.message.includes('No such container')) {
        console.warn('Warning stopping container:', error.message);
      }
    }
    
    // Remove container
    try {
      await container.remove();
      // Wait a bit for removal to complete
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      // Container might already be removed or in process
      if (error.statusCode === 409 || error.message.includes('removal of container')) {
        // Wait for removal to complete
        let attempts = 0;
        while (attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          try {
            await container.inspect();
          } catch (e) {
            if (e.statusCode === 404) break; // Container removed
          }
          attempts++;
        }
      } else if (error.statusCode !== 404) {
        throw error;
      }
    }
    
    // Create port bindings
    const portBindings = {};
    portBindings[`${containerPort}/tcp`] = [{ HostPort: hostPort.toString() }];
    
    // Preserve existing exposed ports
    Object.keys(sandbox.exposedPorts || {}).forEach(cp => {
      portBindings[`${cp}/tcp`] = [{ HostPort: sandbox.exposedPorts[cp].toString() }];
    });

    // Recreate container with port mapping
    const hostConfig = {
      NetworkMode: 'bridge',
      AutoRemove: true,
      PortBindings: portBindings
    };

    if (ORCHESTRATOR_HOST === 'host.docker.internal') {
      hostConfig.ExtraHosts = ['host.docker.internal:host-gateway'];
    }

    const exposedPorts = {};
    Object.keys(portBindings).forEach(port => {
      exposedPorts[port] = {};
    });

    const newContainer = await docker.createContainer({
      Image: AGENT_IMAGE,
      name: `sandbox-${id}`,
      Env: containerInfo.Config.Env,
      HostConfig: hostConfig,
      ExposedPorts: exposedPorts,
      Tty: false,
      OpenStdin: true,
      StdinOnce: false
    });

    await newContainer.start();

    // Update sandbox record
    sandbox.container = newContainer;
    sandbox.exposedPorts[containerPort] = hostPort;
    portMappings.set(hostPort, id);
    
    // Clear old WebSocket connection - agent will reconnect
    if (sandbox.ws) {
      sandbox.ws.close();
      sandbox.ws = null;
      agentConnections.delete(id);
    }
    
    // Wait for agent to reconnect (up to 30 seconds)
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds with 500ms intervals
    while (attempts < maxAttempts && !sandbox.ws) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    
    if (!sandbox.ws) {
      console.warn(`Agent did not reconnect within 30 seconds for sandbox ${id}`);
      // Still return success, but agent might reconnect later
    }

    res.json({
      sandboxId: id,
      containerPort: parseInt(containerPort),
      hostPort,
      url: `http://localhost:${hostPort}`,
      agentReconnected: !!sandbox.ws
    });
  } catch (error) {
    console.error('Error exposing port:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get exposed ports for a sandbox
app.get('/sandbox/:id/ports', authenticateApiKey, (req, res) => {
  const { id } = req.params;
  const sandbox = sandboxes.get(id);

  if (!sandbox) {
    return res.status(404).json({ error: 'Sandbox not found' });
  }

  const ports = Object.entries(sandbox.exposedPorts || {}).map(([containerPort, hostPort]) => ({
    containerPort: parseInt(containerPort),
    hostPort,
    url: `http://localhost:${hostPort}`
  }));

  res.json({ sandboxId: id, ports });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeSandboxes: sandboxes.size
  });
});

// Handle agent responses and route to clients
const handleAgentMessage = (sandboxId, message) => {
  try {
    const data = JSON.parse(message.toString());
    const sandbox = sandboxes.get(sandboxId);
    
    if (sandbox && sandbox.pendingRequests && sandbox.pendingRequests.has(data.id)) {
      const clientWs = sandbox.pendingRequests.get(data.id);
      if (clientWs && clientWs.readyState === 1) {
        clientWs.send(message.toString());
        sandbox.pendingRequests.delete(data.id);
      }
    }
  } catch (error) {
    console.error('Error routing agent message:', error);
  }
};

// WebSocket server for agent and client connections
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');
  
  if (pathParts[1] === 'agent' && pathParts[2]) {
    // Agent connection
    const sandboxId = pathParts[2];
    const sandbox = sandboxes.get(sandboxId);

    if (!sandbox) {
      ws.close(1008, 'Sandbox not found');
      return;
    }

    // Verify JWT token
    const token = url.searchParams.get('token');
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.sandboxId !== sandboxId || decoded.type !== 'agent') {
        throw new Error('Invalid token');
      }
    } catch (error) {
      ws.close(1008, 'Invalid authentication token');
      return;
    }

    sandbox.ws = ws;
    agentConnections.set(sandboxId, ws);
    console.log(`Agent connected: ${sandboxId}`);

    ws.on('message', (message) => {
      handleAgentMessage(sandboxId, message);
    });

    ws.on('close', () => {
      agentConnections.delete(sandboxId);
      if (sandbox) {
        sandbox.ws = null;
      }
      console.log(`Agent disconnected: ${sandboxId}`);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for ${sandboxId}:`, error);
    });

    console.log(`Agent connected: ${sandboxId}`);
  } else if (pathParts[1] === 'client' && pathParts[2]) {
    // SDK client connection
    const sandboxId = pathParts[2];
    const sandbox = sandboxes.get(sandboxId);

    if (!sandbox) {
      ws.close(1008, 'Sandbox not found');
      return;
    }

    // Store client connection
    if (!sandbox.clients) {
      sandbox.clients = new Set();
    }
    sandbox.clients.add(ws);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Forward RPC request to agent
        const agentWs = agentConnections.get(sandboxId);
        if (!agentWs || agentWs.readyState !== 1) {
          ws.send(JSON.stringify({
            id: data.id,
            type: 'error',
            error: 'Agent not connected'
          }));
          return;
        }

        // Send to agent
        agentWs.send(JSON.stringify(data));

        // Store pending request for response routing
        if (!sandbox.pendingRequests) {
          sandbox.pendingRequests = new Map();
        }
        sandbox.pendingRequests.set(data.id, ws);
      } catch (error) {
        console.error('Error handling client message:', error);
        ws.send(JSON.stringify({
          id: data?.id,
          type: 'error',
          error: error.message
        }));
      }
    });

    ws.on('close', () => {
      if (sandbox.clients) {
        sandbox.clients.delete(ws);
      }
    });

    ws.on('error', (error) => {
      console.error(`Client WebSocket error for ${sandboxId}:`, error);
    });

    console.log(`Client connected: ${sandboxId}`);
  }
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`Orchestrator API listening on http://localhost:${PORT}`);
  console.log(`WebSocket server listening on ws://localhost:${WS_PORT}`);
});

