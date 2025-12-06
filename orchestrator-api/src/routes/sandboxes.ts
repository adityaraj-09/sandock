import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';
import { strictLimiter } from '../middleware/security.js';
import { logger } from '../utils/logger.js';
import { ResourceManager } from '../services/resourceManager.js';
import { ContainerOptimizer } from '../services/containerOptimizer.js';
import { portAllocator } from '../services/portAllocator.js';
import { RESOURCE_LIMITS } from '../config/limits.js';
import {
  getImageForLanguage,
  getLanguageConfig,
  isLanguageSupported,
  normalizeLanguage
} from '../config/images.js';
import type {
  AuthenticatedRequest,
  SandboxRouterDependencies,
  Docker,
  SandboxMetadata,
  UserTier
} from '../types/index.js';

const VOLUME_PREFIX = 'sandbox-data-';

export default function createSandboxesRouter(dependencies: SandboxRouterDependencies) {
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
    setPortMapping
  } = dependencies;

  const router = Router();
  const resourceManager = new ResourceManager(docker as unknown as Docker, pool);
  const containerOptimizer = new ContainerOptimizer(docker as unknown as Docker);

  async function ensureDataVolume(sandboxId: string): Promise<string> {
    const volumeName = `${VOLUME_PREFIX}${sandboxId}`;
    try {
      const volume = (docker as unknown as Docker).getVolume(volumeName);
      await volume.inspect();
      logger.debug(`Volume ${volumeName} already exists`);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        await (docker as unknown as Docker).createVolume({
          Name: volumeName,
          Labels: {
            'insien.sandbox.id': sandboxId,
            'insien.sandbox.created': new Date().toISOString()
          }
        });
        logger.info(`Created data volume: ${volumeName}`);
      } else {
        throw error;
      }
    }
    return volumeName;
  }

  async function removeDataVolume(sandboxId: string): Promise<void> {
    const volumeName = `${VOLUME_PREFIX}${sandboxId}`;
    try {
      const volume = (docker as unknown as Docker).getVolume(volumeName);
      await volume.remove();
      logger.info(`Removed data volume: ${volumeName}`);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) {
        logger.error(`Error removing volume ${volumeName}:`, error);
      }
    }
  }

  router.post('/create', authenticateApiKey(), strictLimiter, async (req, res: Response): Promise<void> => {
    const startTime = Date.now();
    let sandboxId: string | null = null;

    try {
      logger.info('[SANDBOX_CREATE] Request received');
      sandboxId = uuidv4();
      const userId = (req as AuthenticatedRequest).user.userId;
      const apiKeyId = (req as AuthenticatedRequest).user.apiKeyId!;
      const userTier = (req.body.tier || (req as AuthenticatedRequest).user.tier || 'free') as UserTier;

      logger.debug(`[SANDBOX_CREATE:${sandboxId}] Starting creation for user ${userId}, apiKey ${apiKeyId}, tier ${userTier}`);

      const canCreate = await resourceManager.canCreateSandbox(userId, apiKeyId, userTier);

      if (!canCreate.allowed) {
        logger.warn(`[SANDBOX_CREATE:${sandboxId}] Quota limit exceeded: ${canCreate.reason}`);
        res.status(429).json({
          error: 'Sandbox creation limit exceeded',
          reason: canCreate.reason
        });
        return;
      }

      const agentToken = jwt.sign(
        { sandboxId, type: 'agent', userId, tier: userTier },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      let containerConfig = resourceManager.getContainerConfig(sandboxId, agentToken, userTier);

      if (ORCHESTRATOR_HOST === 'host.docker.internal') {
        containerConfig.HostConfig.ExtraHosts = ['host.docker.internal:host-gateway'];
      }

      containerConfig = await containerOptimizer.optimizeContainerStartup(containerConfig);

      const optimizedImage = await containerOptimizer.optimizeAgentImage(AGENT_IMAGE);
      containerConfig.Image = optimizedImage;
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Using image: ${optimizedImage}`);

      const container = await (docker as unknown as Docker).createContainer(containerConfig);
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Container created: ${container.id}`);

      const startPromise = container.start();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Container startup timeout')),
        RESOURCE_LIMITS.SYSTEM.CONTAINER_STARTUP_TIMEOUT_SECONDS * 1000)
      );

      await Promise.race([startPromise, timeoutPromise]);
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Container started successfully`);

      const containerInfo = await container.inspect();
      if (!containerInfo.State.Running) {
        const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
        logger.error(`[SANDBOX_CREATE:${sandboxId}] Container stopped immediately. Logs: ${logs.toString()}`);
        throw new Error(`Container stopped immediately. Status: ${containerInfo.State.Status}, ExitCode: ${containerInfo.State.ExitCode}`);
      }

      const containerName = containerConfig.name || `sandbox-${sandboxId}`;

      await pool.query(
        `INSERT INTO sandboxes (id, user_id, api_key_id, status, metadata)
         VALUES ($1, $2, $3, 'active', $4)`,
        [sandboxId, userId, apiKeyId, JSON.stringify({ containerName, containerId: container.id })]
      );

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

      const duration = Date.now() - startTime;
      logger.info(`[SANDBOX_CREATE:${sandboxId}] Sandbox created successfully in ${duration}ms for user ${userId} (tier: ${userTier})`);

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
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[SANDBOX_CREATE:${sandboxId || 'unknown'}] Error after ${duration}ms:`, error);

      if (sandboxId) {
        try {
          const metadata = await getSandboxMetadata(sandboxId);
          if (metadata && metadata.containerId) {
            logger.warn(`[SANDBOX_CREATE:${sandboxId}] Attempting to clean up container ${metadata.containerId}`);
            const container = (docker as unknown as Docker).getContainer(metadata.containerId);
            await container.stop().catch(() => {});
            await container.remove().catch(() => {});
          }
        } catch (cleanupError) {
          logger.error(`[SANDBOX_CREATE:${sandboxId}] Cleanup error:`, cleanupError);
        }
      }

      res.status(500).json({
        error: (error as Error).message,
        sandboxId: sandboxId || null
      });
    }
  });

  router.post('/:id/destroy', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = (req as AuthenticatedRequest).user.userId;

      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        res.status(404).json({ error: 'Sandbox not found' });
        return;
      }

      const metadata = await getSandboxMetadata(id);
      if (!metadata) {
        res.status(404).json({ error: 'Sandbox metadata not found' });
        return;
      }

      if (agentConnections.has(id)) {
        agentConnections.get(id)!.close();
        agentConnections.delete(id);
      }
      await deleteAgentConnection(id);

      try {
        const container = (docker as unknown as Docker).getContainer(metadata.containerId);
        await container.stop();
        await container.remove();
      } catch (err) {
        logger.error('Error removing container:', err);
      }

      await portAllocator.releaseAllPorts(id);

      if (metadata.exposedPorts) {
        for (const hostPort of Object.values(metadata.exposedPorts)) {
          await deletePortMapping(hostPort);
        }
      }

      await removeDataVolume(id);

      await pool.query(
        'UPDATE sandboxes SET status = $1, destroyed_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['destroyed', id]
      );

      await cleanupSandbox(id);

      logger.info(`Sandbox destroyed: ${id} by user ${userId}`);
      res.json({ success: true, sandboxId: id });
    } catch (error) {
      logger.error('Error destroying sandbox:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/:id/status', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = (req as AuthenticatedRequest).user.userId;

      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        res.status(404).json({ error: 'Sandbox not found' });
        return;
      }

      const metadata = await getSandboxMetadata(id);
      const agentConnected = agentConnections.has(id);

      let containerStatus = null;
      if (metadata && metadata.containerId) {
        try {
          const container = (docker as unknown as Docker).getContainer(metadata.containerId);
          const containerInfo = await container.inspect();
          containerStatus = {
            running: containerInfo.State.Running,
            status: containerInfo.State.Status,
            exitCode: containerInfo.State.ExitCode,
            error: containerInfo.State.Error
          };
        } catch {
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
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/:id/expose', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { containerPort } = req.body;
      const userId = (req as AuthenticatedRequest).user.userId;

      if (!containerPort) {
        res.status(400).json({ error: 'containerPort is required' });
        return;
      }

      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        res.status(404).json({ error: 'Sandbox not found' });
        return;
      }

      const metadata = await getSandboxMetadata(id);
      if (!metadata) {
        res.status(404).json({ error: 'Sandbox metadata not found' });
        return;
      }

      if (metadata.exposedPorts && metadata.exposedPorts[containerPort]) {
        const hostPort = metadata.exposedPorts[containerPort];
        res.json({
          sandboxId: id,
          containerPort: parseInt(String(containerPort)),
          hostPort,
          url: `http://localhost:${hostPort}`
        });
        return;
      }

      const hostPort = await portAllocator.allocatePort(id, containerPort);
      const volumeName = await ensureDataVolume(id);

      const container = (docker as unknown as Docker).getContainer(metadata.containerId);
      const containerInfo = await container.inspect();

      if (containerInfo.State.Running) {
        await container.stop();
        let attempts = 0;
        while (attempts < 10) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            const state = await container.inspect();
            if (!state.State.Running) break;
          } catch {
            break;
          }
          attempts++;
        }
      }

      await container.remove();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const portBindings: Record<string, Array<{ HostPort: string }>> = {};
      portBindings[`${containerPort}/tcp`] = [{ HostPort: hostPort.toString() }];

      if (metadata.exposedPorts) {
        Object.keys(metadata.exposedPorts).forEach((cp) => {
          portBindings[`${cp}/tcp`] = [{ HostPort: (metadata.exposedPorts![parseInt(cp)]).toString() }];
        });
      }

      const originalHostConfig = containerInfo.HostConfig;
      const hostConfig = {
        NetworkMode: originalHostConfig.NetworkMode || 'bridge',
        AutoRemove: false,
        PortBindings: portBindings,
        Binds: [`${volumeName}:/app/data:rw`],
        Memory: originalHostConfig.Memory,
        MemorySwap: originalHostConfig.MemorySwap,
        MemoryReservation: originalHostConfig.MemoryReservation,
        CpuShares: originalHostConfig.CpuShares,
        CpuPeriod: originalHostConfig.CpuPeriod,
        CpuQuota: originalHostConfig.CpuQuota,
        SecurityOpt: originalHostConfig.SecurityOpt,
        ReadonlyRootfs: false,
        Ulimits: originalHostConfig.Ulimits,
        Tmpfs: originalHostConfig.Tmpfs,
        Privileged: originalHostConfig.Privileged || false,
        PidsLimit: originalHostConfig.PidsLimit,
        OomKillDisable: originalHostConfig.OomKillDisable || false,
        RestartPolicy: originalHostConfig.RestartPolicy || { Name: 'no' },
        ExtraHosts: ORCHESTRATOR_HOST === 'host.docker.internal'
          ? ['host.docker.internal:host-gateway']
          : undefined
      };

      const exposedPorts: Record<string, object> = {};
      Object.keys(portBindings).forEach((port) => {
        exposedPorts[port] = {};
      });

      const originalEnv = containerInfo.Config.Env || [];
      const originalConfig = containerInfo.Config;

      const newContainer = await (docker as unknown as Docker).createContainer({
        Image: AGENT_IMAGE,
        name: `sandbox-${id}`,
        Env: originalEnv,
        HostConfig: hostConfig,
        ExposedPorts: exposedPorts,
        WorkingDir: originalConfig.WorkingDir || '/app',
        Tty: originalConfig.Tty || false,
        OpenStdin: originalConfig.OpenStdin !== undefined ? originalConfig.OpenStdin : true,
        StdinOnce: originalConfig.StdinOnce || false,
        Labels: originalConfig.Labels || {}
      });

      await newContainer.start();

      const updatedMetadata: SandboxMetadata = {
        ...metadata,
        exposedPorts: { ...metadata.exposedPorts, [containerPort]: hostPort },
        containerId: newContainer.id
      };
      await setSandboxMetadata(id, updatedMetadata);
      await setPortMapping(hostPort, id);

      let attempts = 0;
      const maxAttempts = 60;
      while (attempts < maxAttempts && !agentConnections.has(id)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }

      logger.info(`Port exposed: ${containerPort} -> ${hostPort} for sandbox ${id}`);

      res.json({
        sandboxId: id,
        containerPort: parseInt(String(containerPort)),
        hostPort,
        url: `http://localhost:${hostPort}`,
        agentReconnected: agentConnections.has(id)
      });
    } catch (error) {
      logger.error('Error exposing port:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/:id/ports', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = (req as AuthenticatedRequest).user.userId;

      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        res.status(404).json({ error: 'Sandbox not found' });
        return;
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
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/:id/stats', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = (req as AuthenticatedRequest).user.userId;

      const sandboxResult = await pool.query(
        'SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (sandboxResult.rows.length === 0) {
        res.status(404).json({ error: 'Sandbox not found' });
        return;
      }

      const metadata = await getSandboxMetadata(id);
      if (!metadata || !metadata.containerId) {
        res.status(404).json({ error: 'Container not found' });
        return;
      }

      const stats = await resourceManager.getContainerStats(metadata.containerId);
      if (!stats) {
        res.status(503).json({ error: 'Unable to retrieve container stats' });
        return;
      }

      const violation = await resourceManager.checkResourceViolation(id, metadata.containerId, metadata.tier);
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
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/quota/usage', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const apiKeyId = (req as AuthenticatedRequest).user.apiKeyId!;
      const userTier = ((req as AuthenticatedRequest).user.tier || 'free') as UserTier;

      const userSandboxCount = await pool.query(
        'SELECT COUNT(*) as count FROM sandboxes WHERE user_id = $1 AND status = $2',
        [userId, 'active']
      );

      const apiKeySandboxCount = await pool.query(
        'SELECT COUNT(*) as count FROM sandboxes WHERE api_key_id = $1 AND status = $2',
        [apiKeyId, 'active']
      );

      const tierLimits = resourceManager.getTierLimits(userTier);

      res.json({
        usage: {
          activeSandboxes: parseInt(userSandboxCount.rows[0].count as string),
          apiKeySandboxes: parseInt(apiKeySandboxCount.rows[0].count as string)
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
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/system/stats', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const isAdmin = (req as AuthenticatedRequest).user.email?.endsWith('@insien.com') || process.env.NODE_ENV === 'development';

      if (!isAdmin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
      }

      const systemStats = await resourceManager.getSystemStats();

      const statusStats = await pool.query(`
        SELECT status, COUNT(*) as count
        FROM sandboxes
        GROUP BY status
      `);

      res.json({
        system: systemStats,
        sandboxes: statusStats.rows.reduce((acc: Record<string, number>, row) => {
          acc[row.status as string] = parseInt(row.count as string);
          return acc;
        }, {}),
        limits: RESOURCE_LIMITS
      });
    } catch (error) {
      logger.error('Error getting system stats:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/system/cleanup', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const isAdmin = (req as AuthenticatedRequest).user.email?.endsWith('@insien.com') || process.env.NODE_ENV === 'development';

      if (!isAdmin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
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
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/execute', authenticateApiKey(), strictLimiter, async (req, res: Response): Promise<void> => {
    let sandboxId: string | null = null;
    let container: Awaited<ReturnType<Docker['createContainer']>> | null = null;
    let ws: WebSocket | null = null;

    try {
      const { code, language, timeout: execTimeoutMs } = req.body;
      const userId = (req as AuthenticatedRequest).user.userId;
      const apiKeyId = (req as AuthenticatedRequest).user.apiKeyId!;

      if (!code || !language) {
        res.status(400).json({ error: 'code and language are required' });
        return;
      }

      const normalizedLang = normalizeLanguage(language);
      if (!isLanguageSupported(normalizedLang)) {
        res.status(400).json({
          error: `Unsupported language: ${language}`,
          supportedLanguages: ['javascript', 'python', 'java', 'cpp', 'c', 'go', 'rust']
        });
        return;
      }

      const langConfig = getLanguageConfig(normalizedLang);
      if (!langConfig) {
        res.status(400).json({ error: `No configuration found for language: ${language}` });
        return;
      }

      sandboxId = uuidv4();
      const userTier = (req.body.tier || 'free') as UserTier;

      logger.info(`[CODE_EXECUTE:${sandboxId}] Executing ${normalizedLang} code for user ${userId}`);

      const canCreate = await resourceManager.canCreateSandbox(userId, apiKeyId, userTier);
      if (!canCreate.allowed) {
        res.status(429).json({
          error: 'Sandbox creation limit exceeded',
          reason: canCreate.reason
        });
        return;
      }

      const agentToken = jwt.sign(
        { sandboxId, type: 'agent', userId, tier: userTier },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      const languageImage = getImageForLanguage(normalizedLang);
      logger.info(`[CODE_EXECUTE:${sandboxId}] Using image: ${languageImage} for ${normalizedLang}`);

      const containerConfig = resourceManager.getContainerConfig(sandboxId, agentToken, userTier);
      containerConfig.Image = languageImage;

      if (ORCHESTRATOR_HOST === 'host.docker.internal') {
        containerConfig.HostConfig.ExtraHosts = ['host.docker.internal:host-gateway'];
      }

      container = await (docker as unknown as Docker).createContainer(containerConfig);
      await container.start();

      await pool.query(
        `INSERT INTO sandboxes (id, user_id, api_key_id, status, metadata)
         VALUES ($1, $2, $3, 'active', $4)`,
        [sandboxId, userId, apiKeyId, JSON.stringify({
          containerId: container.id,
          execution: true,
          language: normalizedLang,
          image: languageImage
        })]
      );

      await setSandboxMetadata(sandboxId, {
        userId,
        apiKeyId,
        containerId: container.id,
        createdAt: new Date().toISOString(),
        tier: userTier,
        execution: true,
        language: normalizedLang,
        image: languageImage,
        allowUnauthenticated: true
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      ws = new WebSocket(`${process.env.WS_URL || 'ws://localhost:3001'}/client/${sandboxId}`);

      await new Promise<void>((resolve, reject) => {
        const connectionTimeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
        ws!.on('open', () => {
          clearTimeout(connectionTimeout);
          resolve();
        });
        ws!.on('error', reject);
      });

      const fileName = `main.${langConfig.extension}`;
      const execTimeout = execTimeoutMs || 30000;

      const writeFile = (path: string, content: string): Promise<unknown> => {
        return new Promise((resolve, reject) => {
          const id = uuidv4();
          ws!.send(JSON.stringify({ id, type: 'write', path, content }));
          const handler = (message: WebSocket.Data) => {
            const data = JSON.parse(message.toString());
            if (data.id === id) {
              ws!.removeListener('message', handler);
              if (data.type === 'error') {
                reject(new Error(data.error));
              } else {
                resolve(data);
              }
            }
          };
          ws!.on('message', handler);
          setTimeout(() => {
            ws!.removeListener('message', handler);
            reject(new Error('Write timeout'));
          }, 5000);
        });
      };

      const runCommand = (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        return new Promise((resolve, reject) => {
          const id = uuidv4();
          ws!.send(JSON.stringify({ id, type: 'exec', cmd, args }));
          const handler = (message: WebSocket.Data) => {
            const data = JSON.parse(message.toString());
            if (data.id === id) {
              ws!.removeListener('message', handler);
              if (data.type === 'error') {
                reject(new Error(data.error));
              } else {
                resolve(data);
              }
            }
          };
          ws!.on('message', handler);
          setTimeout(() => {
            ws!.removeListener('message', handler);
            reject(new Error('Execution timeout'));
          }, execTimeout);
        });
      };

      await writeFile(fileName, code);

      let result: { stdout: string; stderr: string; exitCode: number };
      let compileResult: { stdout: string; stderr: string; exitCode: number } | null = null;

      if (langConfig.compile) {
        if (langConfig.command === 'javac') {
          compileResult = await runCommand(langConfig.command, [fileName]);
          if (compileResult.exitCode !== 0) {
            res.json({
              success: false,
              error: 'Compilation failed',
              language: normalizedLang,
              stdout: compileResult.stdout,
              stderr: compileResult.stderr,
              exitCode: compileResult.exitCode
            });
            return;
          }
          const className = fileName.replace('.java', '');
          result = await runCommand(langConfig.runCommand!, [...(langConfig.runArgs || []), className]);
        } else {
          compileResult = await runCommand(langConfig.command, [...langConfig.args, fileName]);
          if (compileResult.exitCode !== 0) {
            res.json({
              success: false,
              error: 'Compilation failed',
              language: normalizedLang,
              stdout: compileResult.stdout,
              stderr: compileResult.stderr,
              exitCode: compileResult.exitCode
            });
            return;
          }
          result = await runCommand('sh', ['-c', langConfig.runCommand!]);
        }
      } else {
        result = await runCommand(langConfig.command, [...langConfig.args, fileName]);
      }

      res.json({
        success: result.exitCode === 0,
        language: normalizedLang,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        compileResult: compileResult ? {
          stdout: compileResult.stdout,
          stderr: compileResult.stderr,
          exitCode: compileResult.exitCode
        } : null
      });
    } catch (error) {
      logger.error(`[CODE_EXECUTE:${sandboxId || 'unknown'}] Error:`, error);
      res.status(500).json({ error: (error as Error).message });
    } finally {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        if (container) {
          await container.stop().catch(() => {});
          await container.remove().catch(() => {});
        }
        if (sandboxId) {
          await cleanupSandbox(sandboxId);
          await pool.query(
            'UPDATE sandboxes SET status = $1, destroyed_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['destroyed', sandboxId]
          );
        }
      } catch (cleanupError) {
        logger.error(`[CODE_EXECUTE:${sandboxId}] Cleanup error:`, cleanupError);
      }
    }
  });

  return router;
}
