/**
 * Container Pool Service
 * Maintains a pool of warm containers for faster execution
 */

import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { redisClient } from './redis.js';
import { getImageForLanguage } from '../config/images.js';
import { RESOURCE_LIMITS, getResourceLimitsForTier } from '../config/limits.js';

const POOL_SIZE_PER_LANGUAGE = parseInt(process.env.POOL_SIZE_PER_LANGUAGE) || 2;
const POOL_REFILL_INTERVAL = parseInt(process.env.POOL_REFILL_INTERVAL) || 60000; // 1 minute
const POOL_KEY_PREFIX = 'pool:container:';

/**
 * ContainerPool - Manages warm container pool for fast execution
 */
export class ContainerPool {
  constructor(docker, jwtSecret) {
    this.docker = docker;
    this.jwtSecret = jwtSecret;
    this.pools = new Map(); // language -> container[]
    this.refillInterval = null;
    this.enabled = process.env.CONTAINER_POOL_ENABLED !== 'false';
  }

  /**
   * Initialize the container pool
   */
  async initialize() {
    if (!this.enabled) {
      logger.info('Container pool is disabled');
      return;
    }

    logger.info('Initializing container pool...');

    try {
      // Clean up any orphaned pool containers
      await this.cleanupOrphanedContainers();

      // Pre-warm containers for each language
      const languages = ['javascript', 'python', 'java', 'cpp', 'go', 'rust'];

      for (const language of languages) {
        this.pools.set(language, []);
        await this.fillPool(language);
      }

      // Start refill interval
      this.refillInterval = setInterval(() => {
        this.refillAllPools().catch(err => {
          logger.error('Error refilling pools:', err);
        });
      }, POOL_REFILL_INTERVAL);

      logger.info('Container pool initialized');
    } catch (error) {
      logger.error('Failed to initialize container pool:', error);
    }
  }

  /**
   * Fill pool for a specific language
   * @param {string} language - Programming language
   */
  async fillPool(language) {
    const pool = this.pools.get(language) || [];
    const needed = POOL_SIZE_PER_LANGUAGE - pool.length;

    if (needed <= 0) return;

    logger.debug(`Filling pool for ${language}: need ${needed} containers`);

    const createPromises = [];
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

  /**
   * Create a warm container
   * @param {string} language - Programming language
   * @returns {Promise<Object>} Container info
   */
  async createWarmContainer(language) {
    const containerId = uuidv4();
    const image = getImageForLanguage(language);

    try {
      // Create a temporary token for the warm container
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
          PidsLimit: 100
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

      // Add host mapping for Linux
      if (process.env.ORCHESTRATOR_HOST === 'host.docker.internal') {
        containerConfig.HostConfig.ExtraHosts = ['host.docker.internal:host-gateway'];
      }

      const container = await this.docker.createContainer(containerConfig);
      await container.start();

      // Store in Redis for tracking
      await redisClient.setEx(
        `${POOL_KEY_PREFIX}${containerId}`,
        3600, // 1 hour TTL
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

  /**
   * Acquire a warm container from the pool
   * @param {string} language - Programming language
   * @param {string} sandboxId - New sandbox ID
   * @param {string} userId - User ID
   * @param {string} tier - User tier
   * @returns {Promise<Object|null>} Container info or null
   */
  async acquireContainer(language, sandboxId, userId, tier) {
    if (!this.enabled) return null;

    const pool = this.pools.get(language);
    if (!pool || pool.length === 0) {
      logger.debug(`No warm containers available for ${language}`);
      return null;
    }

    // Get the oldest container (FIFO)
    const containerInfo = pool.shift();
    if (!containerInfo) return null;

    try {
      const container = this.docker.getContainer(containerInfo.containerId);

      // Verify container is still running
      const inspect = await container.inspect();
      if (!inspect.State.Running) {
        logger.warn(`Warm container ${containerInfo.containerId} is not running, discarding`);
        await this.cleanupContainer(containerInfo);
        return null;
      }

      // Clean up Redis entry for warm container
      await redisClient.del(`${POOL_KEY_PREFIX}${containerInfo.id}`);

      // Update labels
      // Note: Labels also can't be updated on running container
      // The container pool approach works best when container can reconnect with new creds

      logger.info(`Acquired warm container for ${language}: ${containerInfo.containerId.substring(0, 12)}`);

      // Trigger pool refill asynchronously
      this.fillPool(language).catch(err => {
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

  /**
   * Refill all pools
   */
  async refillAllPools() {
    if (!this.enabled) return;

    for (const language of this.pools.keys()) {
      await this.fillPool(language);
    }
  }

  /**
   * Cleanup a container
   * @param {Object} containerInfo - Container info
   */
  async cleanupContainer(containerInfo) {
    try {
      const container = this.docker.getContainer(containerInfo.containerId);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
      await redisClient.del(`${POOL_KEY_PREFIX}${containerInfo.id}`);
    } catch (error) {
      logger.error('Error cleaning up container:', error);
    }
  }

  /**
   * Cleanup orphaned pool containers
   */
  async cleanupOrphanedContainers() {
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

      // Clean up Redis entries
      let cursor = '0';
      do {
        const result = await redisClient.scan(cursor, {
          MATCH: `${POOL_KEY_PREFIX}*`,
          COUNT: 100
        });
        cursor = result.cursor;

        for (const key of result.keys) {
          await redisClient.del(key);
        }
      } while (cursor !== '0');

    } catch (error) {
      logger.error('Error cleaning up orphaned pool containers:', error);
    }
  }

  /**
   * Get pool statistics
   * @returns {Object} Pool statistics
   */
  getStats() {
    const stats = {
      enabled: this.enabled,
      poolSizePerLanguage: POOL_SIZE_PER_LANGUAGE,
      pools: {}
    };

    for (const [lang, pool] of this.pools) {
      stats.pools[lang] = {
        size: pool.length,
        target: POOL_SIZE_PER_LANGUAGE,
        containers: pool.map(c => ({
          id: c.id.substring(0, 8),
          age: Math.floor((Date.now() - c.createdAt) / 1000)
        }))
      };
    }

    return stats;
  }

  /**
   * Shutdown the container pool
   */
  async shutdown() {
    logger.info('Shutting down container pool...');

    if (this.refillInterval) {
      clearInterval(this.refillInterval);
    }

    // Clean up all pool containers
    for (const [language, pool] of this.pools) {
      for (const containerInfo of pool) {
        await this.cleanupContainer(containerInfo);
      }
    }

    this.pools.clear();
    logger.info('Container pool shutdown complete');
  }
}
