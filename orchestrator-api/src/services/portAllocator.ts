import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';
import type { PortAllocation, PortStats } from '../types/index.js';

const PORT_RANGE_START = parseInt(process.env.PORT_RANGE_START || '') || 30000;
const PORT_RANGE_END = parseInt(process.env.PORT_RANGE_END || '') || 40000;
const PORT_LOCK_TTL = 60 * 60 * 24;
const PORT_ALLOCATION_KEY = 'port:allocations';
const PORT_COUNTER_KEY = 'port:counter';

export class PortAllocator {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
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

  async allocatePort(sandboxId: string, containerPort: number): Promise<number> {
    await this.initialize();

    const maxAttempts = PORT_RANGE_END - PORT_RANGE_START;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const nextPort = await redisClient.incr(PORT_COUNTER_KEY);
      const port = PORT_RANGE_START + ((nextPort - PORT_RANGE_START) % (PORT_RANGE_END - PORT_RANGE_START));

      const portKey = `port:${port}`;
      const allocation: PortAllocation = {
        sandboxId,
        containerPort,
        allocatedAt: new Date().toISOString()
      };

      const acquired = await redisClient.setNX(portKey, JSON.stringify(allocation));

      if (acquired) {
        await redisClient.expire(portKey, PORT_LOCK_TTL);

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

  async releasePort(hostPort: number): Promise<void> {
    try {
      const portKey = `port:${hostPort}`;
      const portData = await redisClient.get(portKey);

      if (portData) {
        const parsed = JSON.parse(portData) as PortAllocation;

        await redisClient.hDel(
          `${PORT_ALLOCATION_KEY}:${parsed.sandboxId}`,
          parsed.containerPort.toString()
        );
      }

      await redisClient.del(portKey);
      logger.info(`Port released: ${hostPort}`);
    } catch (error) {
      logger.error(`Error releasing port ${hostPort}:`, error);
    }
  }

  async releaseAllPorts(sandboxId: string): Promise<void> {
    try {
      const allocationsKey = `${PORT_ALLOCATION_KEY}:${sandboxId}`;
      const allocations = await redisClient.hGetAll(allocationsKey);

      if (allocations) {
        for (const hostPort of Object.values(allocations)) {
          await this.releasePort(parseInt(hostPort));
        }
      }

      await redisClient.del(allocationsKey);
      logger.info(`All ports released for sandbox: ${sandboxId}`);
    } catch (error) {
      logger.error(`Error releasing ports for sandbox ${sandboxId}:`, error);
    }
  }

  async getPortsForSandbox(sandboxId: string): Promise<Record<number, number>> {
    try {
      const allocationsKey = `${PORT_ALLOCATION_KEY}:${sandboxId}`;
      const allocations = await redisClient.hGetAll(allocationsKey);

      const result: Record<number, number> = {};
      for (const [containerPort, hostPort] of Object.entries(allocations || {})) {
        result[parseInt(containerPort)] = parseInt(hostPort);
      }

      return result;
    } catch (error) {
      logger.error(`Error getting ports for sandbox ${sandboxId}:`, error);
      return {};
    }
  }

  async isPortAllocated(hostPort: number): Promise<boolean> {
    const portKey = `port:${hostPort}`;
    return (await redisClient.exists(portKey)) === 1;
  }

  async getPortInfo(hostPort: number): Promise<PortAllocation | null> {
    try {
      const portKey = `port:${hostPort}`;
      const data = await redisClient.get(portKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Error getting port info for ${hostPort}:`, error);
      return null;
    }
  }

  async getStats(): Promise<PortStats | null> {
    try {
      let allocatedCount = 0;
      let cursor = 0;

      do {
        const result = await redisClient.scan(cursor, {
          MATCH: 'port:[0-9]*',
          COUNT: 100
        });
        cursor = result.cursor;
        allocatedCount += result.keys.length;
      } while (cursor !== 0);

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

  async cleanup(): Promise<number> {
    try {
      let cursor = 0;
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

          const sandboxExists = await redisClient.exists(sandboxKey);
          if (!sandboxExists) {
            await this.releaseAllPorts(sandboxId);
            cleanedCount++;
          }
        }
      } while (cursor !== 0);

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

export const portAllocator = new PortAllocator();
