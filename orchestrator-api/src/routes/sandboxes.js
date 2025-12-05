import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';
import { strictLimiter } from '../middleware/security.js';
import { logger } from '../utils/logger.js';
import { ResourceManager } from '../services/resourceManager.js';
import { ContainerOptimizer } from '../services/containerOptimizer.js';
import { RESOURCE_LIMITS } from '../config/limits.js';

// Router factory - takes dependencies
export default function createSandboxesRouter(dependencies) {
  const {
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
  } = dependencies;

  const router = express.Router();
  
  // Initialize resource management services
  const resourceManager = new ResourceManager(docker, pool);
  const containerOptimizer = new ContainerOptimizer(docker);

  // Shared port counter (could be moved to Redis for multi-instance)
  let nextAvailablePort = 30000;

  router.post('/create', authenticateApiKey(), strictLimiter, async (req, res) => {
    const startTime = Date.now();
    let sandboxId = null;
    
    try {
      logger.info('[SANDBOX_CREATE] Request received');
      sandboxId = uuidv4();
      const userId = req.user.userId;
      const apiKeyId = req.user.apiKeyId;
      const userTier = req.body.tier || req.user.tier || 'free';
      
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Starting creation for user ${userId}, apiKey ${apiKeyId}, tier ${userTier}`);

      // Check if user can create a new sandbox
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Checking quota limits...`);
      const canCreate = await resourceManager.canCreateSandbox(userId, apiKeyId, userTier);
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Quota check result:`, canCreate);
      
      if (!canCreate.allowed) {
        logger.warn(`[SANDBOX_CREATE:${sandboxId}] Quota limit exceeded: ${canCreate.reason}`);
        return res.status(429).json({ 
          error: 'Sandbox creation limit exceeded',
          reason: canCreate.reason 
        });
      }

      // Create JWT token for agent authentication
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Creating agent JWT token...`);
      const agentToken = jwt.sign(
        { sandboxId, type: 'agent', userId, tier: userTier },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Agent token created`);

      // Get optimized container configuration
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Getting container configuration...`);
      let containerConfig = resourceManager.getContainerConfig(sandboxId, agentToken, userTier);
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Container config created:`, {
        name: containerConfig.name,
        image: containerConfig.Image,
        memory: containerConfig.HostConfig?.Memory,
        cpuShares: containerConfig.HostConfig?.CpuShares
      });
      
      // Add host configuration for orchestrator connection
      if (ORCHESTRATOR_HOST === 'host.docker.internal') {
        containerConfig.HostConfig.ExtraHosts = ['host.docker.internal:host-gateway'];
        logger.debug(`[SANDBOX_CREATE:${sandboxId}] Added host.docker.internal mapping`);
      }

      // Optimize container for faster startup
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Optimizing container startup...`);
      containerConfig = await containerOptimizer.optimizeContainerStartup(containerConfig);
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Container startup optimized`);
      
      // Use optimized image if available
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Getting optimized image for ${AGENT_IMAGE}...`);
      const optimizedImage = await containerOptimizer.optimizeAgentImage(AGENT_IMAGE);
      containerConfig.Image = optimizedImage;
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Using image: ${optimizedImage}`);
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Container config before creation:`, {
        Image: containerConfig.Image,
        name: containerConfig.name,
        Memory: containerConfig.HostConfig?.Memory,
        CpuShares: containerConfig.HostConfig?.CpuShares
      });

      // Create and start container with resource limits
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Creating Docker container...`);
      const container = await docker.createContainer(containerConfig);
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Container created: ${container.id}`);
      
      // Start container with timeout
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Starting container (timeout: ${RESOURCE_LIMITS.SYSTEM.CONTAINER_STARTUP_TIMEOUT_SECONDS}s)...`);
      const startPromise = container.start();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Container startup timeout')), 
        RESOURCE_LIMITS.SYSTEM.CONTAINER_STARTUP_TIMEOUT_SECONDS * 1000)
      );

      await Promise.race([startPromise, timeoutPromise]);
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Container started successfully`);
      
      // Verify container is actually running
      try {
        const containerInfo = await container.inspect();
        
        if (!containerInfo.State.Running) {
          const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
          logger.error(`[SANDBOX_CREATE:${sandboxId}] Container stopped immediately. Logs: ${logs.toString()}`);
          throw new Error(`Container stopped immediately. Status: ${containerInfo.State.Status}, ExitCode: ${containerInfo.State.ExitCode}`);
        }
      } catch (error) {
        logger.error(`[SANDBOX_CREATE:${sandboxId}] Container verification failed:`, error);
        throw error;
      }

      // Get container name from config or container object
      const containerName = containerConfig.name || `sandbox-${sandboxId}`;

      // Store sandbox in database
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Storing sandbox in database...`);
      await pool.query(
        `INSERT INTO sandboxes (id, user_id, api_key_id, status, metadata)
         VALUES ($1, $2, $3, 'active', $4)`,
        [sandboxId, userId, apiKeyId, JSON.stringify({ containerName, containerId: container.id })]
      );
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Sandbox stored in database`);

      // Store metadata in Redis with enhanced information
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Storing metadata in Redis...`);
      await setSandboxMetadata(sandboxId, {
        userId,
        apiKeyId,
        containerId: container.id,
        createdAt: new Date().toISOString(),
        tier: userTier,
        exposedPorts: {},
        resourceLimits: {
          memory: containerConfig.HostConfig.Memory,
          cpu: containerConfig.HostConfig.CpuShares,
          storage: containerConfig.HostConfig.StorageOpt?.size
        },
        image: optimizedImage,
        expiresAt: new Date(Date.now() + RESOURCE_LIMITS.USER.SANDBOX_LIFETIME_HOURS * 60 * 60 * 1000).toISOString()
      });
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Metadata stored in Redis`);

      const duration = Date.now() - startTime;
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Sandbox created successfully in ${duration}ms for user ${userId} (tier: ${userTier})`);
      
      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Sending response...`);
      res.json({
        sandboxId,
        agentUrl: `ws://localhost:${WS_PORT}/agent/${sandboxId}`,
        tier: userTier,
        resourceLimits: {
          memoryMB: Math.floor(containerConfig.HostConfig.Memory / (1024 * 1024)),
          cpuShares: containerConfig.HostConfig.CpuShares,
          lifetimeHours: RESOURCE_LIMITS.USER.SANDBOX_LIFETIME_HOURS
        },
        expiresAt: new Date(Date.now() + RESOURCE_LIMITS.USER.SANDBOX_LIFETIME_HOURS * 60 * 60 * 1000).toISOString()
      });
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Response sent successfully`);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[SANDBOX_CREATE:${sandboxId || 'unknown'}] Error after ${duration}ms:`, error);
      logger.error(`[SANDBOX_CREATE:${sandboxId || 'unknown'}] Error stack:`, error.stack);
      
      // Try to clean up container if it was created
      if (sandboxId) {
        try {
          const metadata = await getSandboxMetadata(sandboxId);
          if (metadata && metadata.containerId) {
            logger.warn(`[SANDBOX_CREATE:${sandboxId}] Attempting to clean up container ${metadata.containerId}`);
            const container = docker.getContainer(metadata.containerId);
            await container.stop().catch(() => {});
            await container.remove().catch(() => {});
          }
        } catch (cleanupError) {
          logger.error(`[SANDBOX_CREATE:${sandboxId}] Cleanup error:`, cleanupError);
        }
      }
      
      res.status(500).json({ 
        error: error.message,
        sandboxId: sandboxId || null
      });
    }
  });

  // Destroy sandbox
  router.post('/:id/destroy', authenticateApiKey(), async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      // Verify sandbox belongs to user
      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sandbox not found' });
      }

      const metadata = await getSandboxMetadata(id);
      if (!metadata) {
        return res.status(404).json({ error: 'Sandbox metadata not found' });
      }

      // Close WebSocket connections
      if (agentConnections.has(id)) {
        agentConnections.get(id).close();
        agentConnections.delete(id);
      }
      await deleteAgentConnection(id);

      // Stop and remove container
      try {
        const container = docker.getContainer(metadata.containerId);
        await container.stop();
        await container.remove();
      } catch (err) {
        logger.error('Error removing container:', err);
      }

      // Clean up port mappings
      if (metadata.exposedPorts) {
        for (const hostPort of Object.values(metadata.exposedPorts)) {
          await deletePortMapping(hostPort);
        }
      }

      // Update database
      await pool.query(
        'UPDATE sandboxes SET status = $1, destroyed_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['destroyed', id]
      );

      // Cleanup Redis
      await cleanupSandbox(id);

      logger.info(`Sandbox destroyed: ${id} by user ${userId}`);
      res.json({ success: true, sandboxId: id });
    } catch (error) {
      logger.error('Error destroying sandbox:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get sandbox status
  router.get('/:id/status', authenticateApiKey(), async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sandbox not found' });
      }

      const metadata = await getSandboxMetadata(id);
      const agentConnected = agentConnections.has(id);
      
      // Check container status if metadata exists
      let containerStatus = null;
      if (metadata && metadata.containerId) {
        try {
          const container = docker.getContainer(metadata.containerId);
          const containerInfo = await container.inspect();
          containerStatus = {
            running: containerInfo.State.Running,
            status: containerInfo.State.Status,
            exitCode: containerInfo.State.ExitCode,
            error: containerInfo.State.Error
          };
        } catch (error) {
          containerStatus = { error: 'Container not found or removed' };
        }
      }

      res.json({
        sandboxId: id,
        connected: agentConnected,
        createdAt: sandboxResult.rows[0].created_at,
        status: sandboxResult.rows[0].status,
        containerStatus
      });
    } catch (error) {
      logger.error('Error getting sandbox status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Expose port
  router.post('/:id/expose', authenticateApiKey(), async (req, res) => {
    try {
      const { id } = req.params;
      const { containerPort } = req.body;
      const userId = req.user.userId;

      if (!containerPort) {
        return res.status(400).json({ error: 'containerPort is required' });
      }

      // Verify sandbox belongs to user
      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sandbox not found' });
      }

      const metadata = await getSandboxMetadata(id);
      if (!metadata) {
        return res.status(404).json({ error: 'Sandbox metadata not found' });
      }

      // Check if port is already exposed
      if (metadata.exposedPorts && metadata.exposedPorts[containerPort]) {
        const hostPort = metadata.exposedPorts[containerPort];
        return res.json({
          sandboxId: id,
          containerPort: parseInt(containerPort),
          hostPort,
          url: `http://localhost:${hostPort}`
        });
      }

      // Find available host port
      let hostPort = nextAvailablePort;
      while (await getPortMapping(hostPort)) {
        hostPort++;
      }
      nextAvailablePort = hostPort + 1;

      // Get container and recreate with port mapping
      const container = docker.getContainer(metadata.containerId);
      let containerInfo;
      
      try {
        containerInfo = await container.inspect();
      } catch (error) {
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
        if (!error.message.includes('not running') && !error.message.includes('No such container')) {
          logger.warn('Warning stopping container:', error.message);
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
      if (metadata.exposedPorts) {
        Object.keys(metadata.exposedPorts).forEach(cp => {
          portBindings[`${cp}/tcp`] = [{ HostPort: metadata.exposedPorts[cp].toString() }];
        });
      }

      // Recreate container with port mapping - preserve original config
      const originalHostConfig = containerInfo.HostConfig || {};
      const hostConfig = {
        NetworkMode: originalHostConfig.NetworkMode || 'bridge',
        AutoRemove: false, // Changed to false to match original config
        PortBindings: portBindings,
        // Preserve original resource limits
        Memory: originalHostConfig.Memory,
        MemorySwap: originalHostConfig.MemorySwap,
        MemoryReservation: originalHostConfig.MemoryReservation,
        CpuShares: originalHostConfig.CpuShares,
        CpuPeriod: originalHostConfig.CpuPeriod,
        CpuQuota: originalHostConfig.CpuQuota,
        // Preserve security settings
        SecurityOpt: originalHostConfig.SecurityOpt,
        ReadonlyRootfs: false, // Keep writable
        Ulimits: originalHostConfig.Ulimits,
        Tmpfs: originalHostConfig.Tmpfs,
        Privileged: originalHostConfig.Privileged || false,
        PidsLimit: originalHostConfig.PidsLimit,
        OomKillDisable: originalHostConfig.OomKillDisable || false,
        RestartPolicy: originalHostConfig.RestartPolicy || { Name: 'no' }
      };

      if (ORCHESTRATOR_HOST === 'host.docker.internal') {
        hostConfig.ExtraHosts = ['host.docker.internal:host-gateway'];
      }

      const exposedPorts = {};
      Object.keys(portBindings).forEach(port => {
        exposedPorts[port] = {};
      });

      // Get original container environment and config
      const originalEnv = containerInfo.Config.Env || [];
      const originalConfig = containerInfo.Config || {};
      
      const newContainer = await docker.createContainer({
        Image: AGENT_IMAGE,
        name: `sandbox-${id}`,
        Env: originalEnv,
        HostConfig: hostConfig,
        ExposedPorts: exposedPorts,
        WorkingDir: originalConfig.WorkingDir || '/app', // Preserve working directory
        Tty: originalConfig.Tty || false,
        OpenStdin: originalConfig.OpenStdin !== undefined ? originalConfig.OpenStdin : true,
        StdinOnce: originalConfig.StdinOnce || false,
        Labels: originalConfig.Labels || {}
      });

      await newContainer.start();

      // Update metadata
      metadata.exposedPorts = metadata.exposedPorts || {};
      metadata.exposedPorts[containerPort] = hostPort;
      metadata.containerId = newContainer.id;
      await setSandboxMetadata(id, metadata);
      await setPortMapping(hostPort, id);

      // Wait for agent to reconnect (up to 30 seconds)
      let attempts = 0;
      const maxAttempts = 60;
      while (attempts < maxAttempts && !agentConnections.has(id)) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }

      logger.info(`Port exposed: ${containerPort} -> ${hostPort} for sandbox ${id}`);
      
      res.json({
        sandboxId: id,
        containerPort: parseInt(containerPort),
        hostPort,
        url: `http://localhost:${hostPort}`,
        agentReconnected: agentConnections.has(id)
      });
    } catch (error) {
      logger.error('Error exposing port:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get exposed ports
  router.get('/:id/ports', authenticateApiKey(), async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      // Verify sandbox belongs to user
      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sandbox not found' });
      }

      const metadata = await getSandboxMetadata(id);
      const ports = Object.entries(metadata?.exposedPorts || {}).map(([containerPort, hostPort]) => ({
        containerPort: parseInt(containerPort),
        hostPort,
        url: `http://localhost:${hostPort}`
      }));

      res.json({ sandboxId: id, ports });
    } catch (error) {
      logger.error('Error getting ports:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get sandbox resource usage
  router.get('/:id/stats', authenticateApiKey(), async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      // Verify sandbox belongs to user
      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sandbox not found' });
      }

      const metadata = await getSandboxMetadata(id);
      if (!metadata || !metadata.containerId) {
        return res.status(404).json({ error: 'Container not found' });
      }

      // Get container stats
      const stats = await resourceManager.getContainerStats(metadata.containerId);
      if (!stats) {
        return res.status(503).json({ error: 'Unable to retrieve container stats' });
      }

      // Check for resource violations
      const violation = await resourceManager.checkResourceViolation(id, metadata.containerId, metadata.tier);

      // Get optimization recommendations
      const recommendations = await containerOptimizer.getOptimizationRecommendations(metadata.containerId);

      res.json({
        sandboxId: id,
        stats,
        resourceLimits: metadata.resourceLimits,
        violations: violation.violations || [],
        recommendations,
        tier: metadata.tier || 'free'
      });
    } catch (error) {
      logger.error('Error getting sandbox stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get user's sandbox quota and usage
  router.get('/quota/usage', authenticateApiKey(), async (req, res) => {
    try {
      const userId = req.user.userId;
      const apiKeyId = req.user.apiKeyId;
      const userTier = req.user.tier || 'free';

      // Get current sandbox count
      const userSandboxCount = await pool.query(
        'SELECT COUNT(*) as count FROM sandboxes WHERE user_id = $1 AND status = $2',
        [userId, 'active']
      );

      const apiKeySandboxCount = await pool.query(
        'SELECT COUNT(*) as count FROM sandboxes WHERE api_key_id = $1 AND status = $2',
        [apiKeyId, 'active']
      );

      // Get tier limits
      const tierLimits = resourceManager.getTierLimits ? 
        resourceManager.getTierLimits(userTier) : 
        { maxSandboxes: RESOURCE_LIMITS.USER.MAX_SANDBOXES_PER_USER };

      res.json({
        usage: {
          activeSandboxes: parseInt(userSandboxCount.rows[0].count),
          apiKeySandboxes: parseInt(apiKeySandboxCount.rows[0].count)
        },
        limits: {
          maxSandboxes: tierLimits.maxSandboxes,
          maxApiKeySandboxes: RESOURCE_LIMITS.USER.MAX_SANDBOXES_PER_API_KEY,
          lifetimeHours: RESOURCE_LIMITS.USER.SANDBOX_LIFETIME_HOURS,
          memoryMB: tierLimits.maxMemoryMB,
          cpuShares: tierLimits.maxCpuShares
        },
        tier: userTier
      });
    } catch (error) {
      logger.error('Error getting quota usage:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // System stats endpoint (admin only)
  router.get('/system/stats', authenticateApiKey(), async (req, res) => {
    try {
      // Check if user has admin privileges (you might want to add proper admin check)
      const isAdmin = req.user.email?.endsWith('@insien.com') || process.env.NODE_ENV === 'development';
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const systemStats = await resourceManager.getSystemStats();
      
      // Get total sandboxes by status
      const statusStats = await pool.query(`
        SELECT status, COUNT(*) as count 
        FROM sandboxes 
        GROUP BY status
      `);

      res.json({
        system: systemStats,
        sandboxes: statusStats.rows.reduce((acc, row) => {
          acc[row.status] = parseInt(row.count);
          return acc;
        }, {}),
        limits: RESOURCE_LIMITS
      });
    } catch (error) {
      logger.error('Error getting system stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cleanup endpoint (admin only)
  router.post('/system/cleanup', authenticateApiKey(), async (req, res) => {
    try {
      // Check if user has admin privileges
      const isAdmin = req.user.email?.endsWith('@insien.com') || process.env.NODE_ENV === 'development';
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const cleanedSandboxes = await resourceManager.cleanupExpiredSandboxes();
      const cleanedImages = await containerOptimizer.cleanupUnusedImages();

      res.json({
        success: true,
        cleaned: {
          sandboxes: cleanedSandboxes,
          images: cleanedImages
        }
      });
    } catch (error) {
      logger.error('Error during cleanup:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

