import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { redisClient } from './redis.js';
import { getImageForLanguage } from '../config/images.js';
import { RESOURCE_LIMITS, getResourceLimitsForTier } from '../config/limits.js';
import type { Docker, Container, WarmContainer, PoolStats, UserTier } from '../types/index.js';

const POOL_SIZE_PER_LANGUAGE = parseInt(process.env.POOL_SIZE_PER_LANGUAGE || '') || 2;
const POOL_REFILL_INTERVAL = parseInt(process.env.POOL_REFILL_INTERVAL || '') || 60000;
const POOL_KEY_PREFIX = 'pool:container:';

interface AcquiredContainer {
  container: Container;
  containerId: string;
  warmId: string;
}

export class ContainerPool {
  private docker: Docker;
  private jwtSecret: string;
  private pools: Map<string, WarmContainer[]> = new Map();
  private refillInterval: NodeJS.Timeout | null = null;
  private enabled: boolean;

  constructor(docker: Docker, jwtSecret: string) {
    this.docker = docker;
    this.jwtSecret = jwtSecret;
    this.enabled = process.env.CONTAINER_POOL_ENABLED !== 'false';
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      logger.info('Container pool is disabled');
      return;
    }

    logger.info('Initializing container pool...');

    try {
      await this.cleanupOrphanedContainers();

      const languages = ['javascript', 'python', 'java', 'cpp', 'go', 'rust'];

      for (const language of languages) {
        this.pools.set(language, []);
        await this.fillPool(language);
      }

      this.refillInterval = setInterval(() => {
        this.refillAllPools().catch((err) => {
          logger.error('Error refilling pools:', err);
        });
      }, POOL_REFILL_INTERVAL);

      logger.info('Container pool initialized');
    } catch (error) {
      logger.error('Failed to initialize container pool:', error);
    }
  }

  async fillPool(language: string): Promise<void> {
    const pool = this.pools.get(language) || [];
    const needed = POOL_SIZE_PER_LANGUAGE - pool.length;

    if (needed <= 0) return;

    logger.debug(`Filling pool for ${language}: need ${needed} containers`);

    const createPromises: Promise<WarmContainer | null>[] = [];
    for (let i = 0; i < needed; i++) {
      createPromises.push(this.createWarmContainer(language));
    }

    const results = await Promise.allSettled(createPromises);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        pool.push(result.value);
      }
    }

    this.pools.set(language, pool);
    logger.debug(`Pool for ${language}: ${pool.length}/${POOL_SIZE_PER_LANGUAGE}`);
  }

  async createWarmContainer(language: string): Promise<WarmContainer | null> {
    const containerId = uuidv4();
    const image = getImageForLanguage(language);

    try {
      const warmToken = jwt.sign(
        {
          sandboxId: containerId,
          type: 'warm',
          language
        },
        this.jwtSecret,
        { expiresIn: '1h' }
      );

      const tierLimits = getResourceLimitsForTier('free');

      const containerConfig = {
        name: `warm-${language}-${containerId.substring(0, 8)}`,
        Image: image,
        Env: [
          `ORCHESTRATOR_URL=ws://${process.env.ORCHESTRATOR_HOST || 'host.docker.internal'}:${process.env.WS_PORT || 3001}`,
          `AGENT_TOKEN=${warmToken}`,
          `SANDBOX_ID=${containerId}`,
          `WARM_CONTAINER=true`
        ],
        HostConfig: {
          NetworkMode: 'bridge',
          AutoRemove: false,
          Memory: tierLimits.Memory,
          MemorySwap: tierLimits.MemorySwap,
          CpuShares: tierLimits.CpuShares,
          SecurityOpt: RESOURCE_LIMITS.CONTAINER.SECURITY_OPT,
          PidsLimit: 100,
          ExtraHosts: process.env.ORCHESTRATOR_HOST === 'host.docker.internal'
            ? ['host.docker.internal:host-gateway']
            : undefined
        },
        Labels: {
          'insien.sandbox.pool': 'true',
          'insien.sandbox.language': language,
          'insien.sandbox.warm': 'true',
          'insien.sandbox.created': new Date().toISOString()
        },
        WorkingDir: '/app',
        Tty: false,
        OpenStdin: true
      };

      const container = await this.docker.createContainer(containerConfig);
      await container.start();

      await redisClient.setEx(
        `${POOL_KEY_PREFIX}${containerId}`,
        3600,
        JSON.stringify({
          containerId: container.id,
          language,
          createdAt: new Date().toISOString()
        })
      );

      logger.debug(`Created warm container for ${language}: ${container.id.substring(0, 12)}`);

      return {
        id: containerId,
        containerId: container.id,
        language,
        createdAt: Date.now()
      };
    } catch (error) {
      logger.error(`Failed to create warm container for ${language}:`, error);
      return null;
    }
  }

  async acquireContainer(
    language: string,
    _sandboxId: string,
    _userId: string,
    _tier: UserTier
  ): Promise<AcquiredContainer | null> {
    if (!this.enabled) return null;

    const pool = this.pools.get(language);
    if (!pool || pool.length === 0) {
      logger.debug(`No warm containers available for ${language}`);
      return null;
    }

    const containerInfo = pool.shift();
    if (!containerInfo) return null;

    try {
      const container = this.docker.getContainer(containerInfo.containerId);

      const inspect = await container.inspect();
      if (!inspect.State.Running) {
        logger.warn(`Warm container ${containerInfo.containerId} is not running, discarding`);
        await this.cleanupContainer(containerInfo);
        return null;
      }

      await redisClient.del(`${POOL_KEY_PREFIX}${containerInfo.id}`);

      logger.info(`Acquired warm container for ${language}: ${containerInfo.containerId.substring(0, 12)}`);

      this.fillPool(language).catch((err) => {
        logger.error(`Error refilling pool for ${language}:`, err);
      });

      return {
        container,
        containerId: containerInfo.containerId,
        warmId: containerInfo.id
      };
    } catch (error) {
      logger.error('Error acquiring warm container:', error);
      await this.cleanupContainer(containerInfo);
      return null;
    }
  }

  async refillAllPools(): Promise<void> {
    if (!this.enabled) return;

    for (const language of this.pools.keys()) {
      await this.fillPool(language);
    }
  }

  async cleanupContainer(containerInfo: WarmContainer): Promise<void> {
    try {
      const container = this.docker.getContainer(containerInfo.containerId);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
      await redisClient.del(`${POOL_KEY_PREFIX}${containerInfo.id}`);
    } catch (error) {
      logger.error('Error cleaning up container:', error);
    }
  }

  async cleanupOrphanedContainers(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ['insien.sandbox.pool=true']
        }
      });

      for (const containerInfo of containers) {
        try {
          const container = this.docker.getContainer(containerInfo.Id);
          await container.stop({ t: 5 }).catch(() => {});
          await container.remove({ force: true }).catch(() => {});
          logger.debug(`Cleaned up orphaned pool container: ${containerInfo.Id.substring(0, 12)}`);
        } catch (error) {
          logger.error('Error cleaning up orphaned container:', error);
        }
      }

      let cursor = 0;
      do {
        const result = await redisClient.scan(cursor, {
          MATCH: `${POOL_KEY_PREFIX}*`,
          COUNT: 100
        });
        cursor = result.cursor;

        for (const key of result.keys) {
          await redisClient.del(key);
        }
      } while (cursor !== 0);
    } catch (error) {
      logger.error('Error cleaning up orphaned pool containers:', error);
    }
  }

  getStats(): PoolStats {
    const stats: PoolStats = {
      enabled: this.enabled,
      poolSizePerLanguage: POOL_SIZE_PER_LANGUAGE,
      pools: {}
    };

    for (const [lang, pool] of this.pools) {
      stats.pools[lang] = {
        size: pool.length,
        target: POOL_SIZE_PER_LANGUAGE,
        containers: pool.map((c) => ({
          id: c.id.substring(0, 8),
          age: Math.floor((Date.now() - c.createdAt) / 1000)
        }))
      };
    }

    return stats;
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down container pool...');

    if (this.refillInterval) {
      clearInterval(this.refillInterval);
    }

    for (const [_language, pool] of this.pools) {
      for (const containerInfo of pool) {
        await this.cleanupContainer(containerInfo);
      }
    }

    this.pools.clear();
    logger.info('Container pool shutdown complete');
  }
}
