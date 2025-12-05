/**
 * Redis-based Port Allocation Service
 * Provides distributed, race-condition-free port allocation
 */

import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';

const PORT_RANGE_START = parseInt(process.env.PORT_RANGE_START) || 30000;
const PORT_RANGE_END = parseInt(process.env.PORT_RANGE_END) || 40000;
const PORT_LOCK_TTL = 60 * 60 * 24; // 24 hours in seconds
const PORT_ALLOCATION_KEY = 'port:allocations';
const PORT_COUNTER_KEY = 'port:counter';

/**
 * PortAllocator - Distributed port allocation using Redis
 */
export class PortAllocator {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the port allocator
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize counter if not exists
      const exists = await redisClient.exists(PORT_COUNTER_KEY);
      if (!exists) {
        await redisClient.set(PORT_COUNTER_KEY, PORT_RANGE_START.toString());
      }
      this.initialized = true;
      logger.info(`PortAllocator initialized (range: ${PORT_RANGE_START}-${PORT_RANGE_END})`);
    } catch (error) {
      logger.error('Failed to initialize PortAllocator:', error);
      throw error;
    }
  }

  /**
   * Allocate a port for a sandbox
   * @param {string} sandboxId - Sandbox ID
   * @param {number} containerPort - Container port being exposed
   * @returns {Promise<number>} Allocated host port
   */
  async allocatePort(sandboxId, containerPort) {
    await this.initialize();

    const maxAttempts = PORT_RANGE_END - PORT_RANGE_START;
    let attempts = 0;

    while (attempts < maxAttempts) {
      // Atomically increment and get the next port
      const nextPort = await redisClient.incr(PORT_COUNTER_KEY);

      // Wrap around if we exceed the range
      const port = PORT_RANGE_START + ((nextPort - PORT_RANGE_START) % (PORT_RANGE_END - PORT_RANGE_START));

      // Try to acquire the port atomically using SETNX
      const portKey = `port:${port}`;
      const acquired = await redisClient.setNX(portKey, JSON.stringify({
        sandboxId,
        containerPort,
        allocatedAt: new Date().toISOString()
      }));

      if (acquired) {
        // Set TTL on the port allocation
        await redisClient.expire(portKey, PORT_LOCK_TTL);

        // Store in sandbox's port list
        await redisClient.hSet(
          `${PORT_ALLOCATION_KEY}:${sandboxId}`,
          containerPort.toString(),
          port.toString()
        );

        logger.info(`Port allocated: ${port} for sandbox ${sandboxId} (container port: ${containerPort})`);
        return port;
      }

      attempts++;
    }

    throw new Error('No available ports in range');
  }

  /**
   * Release a port allocation
   * @param {number} hostPort - Host port to release
   */
  async releasePort(hostPort) {
    try {
      const portKey = `port:${hostPort}`;
      const portData = await redisClient.get(portKey);

      if (portData) {
        const parsed = JSON.parse(portData);

        // Remove from sandbox's port list
        await redisClient.hDel(
          `${PORT_ALLOCATION_KEY}:${parsed.sandboxId}`,
          parsed.containerPort.toString()
        );
      }

      // Delete the port allocation
      await redisClient.del(portKey);
      logger.info(`Port released: ${hostPort}`);
    } catch (error) {
      logger.error(`Error releasing port ${hostPort}:`, error);
    }
  }

  /**
   * Release all ports for a sandbox
   * @param {string} sandboxId - Sandbox ID
   */
  async releaseAllPorts(sandboxId) {
    try {
      const allocationsKey = `${PORT_ALLOCATION_KEY}:${sandboxId}`;
      const allocations = await redisClient.hGetAll(allocationsKey);

      if (allocations) {
        for (const [containerPort, hostPort] of Object.entries(allocations)) {
          await this.releasePort(parseInt(hostPort));
        }
      }

      // Delete the sandbox's allocation hash
      await redisClient.del(allocationsKey);
      logger.info(`All ports released for sandbox: ${sandboxId}`);
    } catch (error) {
      logger.error(`Error releasing ports for sandbox ${sandboxId}:`, error);
    }
  }

  /**
   * Get all allocated ports for a sandbox
   * @param {string} sandboxId - Sandbox ID
   * @returns {Promise<Object>} Map of containerPort -> hostPort
   */
  async getPortsForSandbox(sandboxId) {
    try {
      const allocationsKey = `${PORT_ALLOCATION_KEY}:${sandboxId}`;
      const allocations = await redisClient.hGetAll(allocationsKey);

      const result = {};
      for (const [containerPort, hostPort] of Object.entries(allocations || {})) {
        result[parseInt(containerPort)] = parseInt(hostPort);
      }

      return result;
    } catch (error) {
      logger.error(`Error getting ports for sandbox ${sandboxId}:`, error);
      return {};
    }
  }

  /**
   * Check if a port is allocated
   * @param {number} hostPort - Host port to check
   * @returns {Promise<boolean>} Whether the port is allocated
   */
  async isPortAllocated(hostPort) {
    const portKey = `port:${hostPort}`;
    return await redisClient.exists(portKey) === 1;
  }

  /**
   * Get port allocation info
   * @param {number} hostPort - Host port
   * @returns {Promise<Object|null>} Port allocation info or null
   */
  async getPortInfo(hostPort) {
    try {
      const portKey = `port:${hostPort}`;
      const data = await redisClient.get(portKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Error getting port info for ${hostPort}:`, error);
      return null;
    }
  }

  /**
   * Get statistics about port allocation
   * @returns {Promise<Object>} Port allocation statistics
   */
  async getStats() {
    try {
      // Count allocated ports by scanning
      let allocatedCount = 0;
      let cursor = '0';

      do {
        const result = await redisClient.scan(cursor, {
          MATCH: 'port:[0-9]*',
          COUNT: 100
        });
        cursor = result.cursor;
        allocatedCount += result.keys.length;
      } while (cursor !== '0');

      return {
        rangeStart: PORT_RANGE_START,
        rangeEnd: PORT_RANGE_END,
        totalPorts: PORT_RANGE_END - PORT_RANGE_START,
        allocatedPorts: allocatedCount,
        availablePorts: (PORT_RANGE_END - PORT_RANGE_START) - allocatedCount
      };
    } catch (error) {
      logger.error('Error getting port stats:', error);
      return null;
    }
  }

  /**
   * Cleanup expired port allocations
   * Note: Redis TTL handles most cleanup, this is for orphaned entries
   */
  async cleanup() {
    try {
      let cursor = '0';
      let cleanedCount = 0;

      do {
        const result = await redisClient.scan(cursor, {
          MATCH: `${PORT_ALLOCATION_KEY}:*`,
          COUNT: 100
        });
        cursor = result.cursor;

        for (const key of result.keys) {
          const sandboxId = key.replace(`${PORT_ALLOCATION_KEY}:`, '');
          const sandboxKey = `sandbox:${sandboxId}`;

          // Check if sandbox still exists
          const sandboxExists = await redisClient.exists(sandboxKey);
          if (!sandboxExists) {
            await this.releaseAllPorts(sandboxId);
            cleanedCount++;
          }
        }
      } while (cursor !== '0');

      if (cleanedCount > 0) {
        logger.info(`Cleaned up port allocations for ${cleanedCount} orphaned sandboxes`);
      }

      return cleanedCount;
    } catch (error) {
      logger.error('Error during port cleanup:', error);
      return 0;
    }
  }
}

// Singleton instance
export const portAllocator = new PortAllocator();
