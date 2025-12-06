import { logger } from '../utils/logger.js';
import { RESOURCE_LIMITS, getResourceLimitsForTier, getTierLimits } from '../config/limits.js';
import { getSandboxMetadata } from './redis.js';
import type {
  Docker,
  PgPool,
  ContainerConfig,
  ContainerStats,
  ResourceViolation,
  UserTier,
  TierLimits
} from '../types/index.js';

interface CanCreateResult {
  allowed: boolean;
  reason?: string;
}

interface SystemStats {
  totalContainers: number;
  totalMemoryUsage: number;
  totalCpuUsage: number;
  lastUpdated?: string;
}

interface ViolationResult {
  violation: boolean;
  violations: ResourceViolation[];
  stats?: ContainerStats;
}

export class ResourceManager {
  private docker: Docker;
  private pool: PgPool;
  private systemStats: SystemStats = {
    totalContainers: 0,
    totalMemoryUsage: 0,
    totalCpuUsage: 0
  };

  constructor(docker: Docker, pool: PgPool) {
    this.docker = docker;
    this.pool = pool;
  }

  async canCreateSandbox(
    userId: string,
    apiKeyId: string,
    userTier: UserTier = 'free'
  ): Promise<CanCreateResult> {
    try {
      const userSandboxCount = await this.pool.query(
        'SELECT COUNT(*) as count FROM sandboxes WHERE user_id = $1 AND status = $2',
        [userId, 'active']
      );

      const _tierLimits = getResourceLimitsForTier(userTier);
      const tierInfo = getTierLimits(userTier);
      const maxSandboxes = tierInfo.maxSandboxes || RESOURCE_LIMITS.USER.MAX_SANDBOXES_PER_USER;

      if (parseInt(userSandboxCount.rows[0].count as string) >= maxSandboxes) {
        return {
          allowed: false,
          reason: `Maximum sandboxes limit reached (${maxSandboxes})`
        };
      }

      const apiKeySandboxCount = await this.pool.query(
        'SELECT COUNT(*) as count FROM sandboxes WHERE api_key_id = $1 AND status = $2',
        [apiKeyId, 'active']
      );

      if (parseInt(apiKeySandboxCount.rows[0].count as string) >= RESOURCE_LIMITS.USER.MAX_SANDBOXES_PER_API_KEY) {
        return {
          allowed: false,
          reason: `API key sandbox limit reached (${RESOURCE_LIMITS.USER.MAX_SANDBOXES_PER_API_KEY})`
        };
      }

      const totalSandboxCount = await this.pool.query(
        'SELECT COUNT(*) as count FROM sandboxes WHERE status = $1',
        ['active']
      );

      if (parseInt(totalSandboxCount.rows[0].count as string) >= RESOURCE_LIMITS.SYSTEM.MAX_TOTAL_SANDBOXES) {
        return {
          allowed: false,
          reason: 'System capacity limit reached. Please try again later.'
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Error checking sandbox creation limits:', error);
      return {
        allowed: false,
        reason: 'Unable to verify resource limits'
      };
    }
  }

  getContainerConfig(sandboxId: string, agentToken: string, userTier: UserTier = 'free'): ContainerConfig {
    const tierLimits = getResourceLimitsForTier(userTier);
    const tierInfo = getTierLimits(userTier);

    const hostConfig = {
      NetworkMode: 'bridge',
      AutoRemove: false,
      Memory: tierLimits.Memory,
      MemorySwap: tierLimits.MemorySwap,
      MemoryReservation: Math.floor(tierLimits.Memory * 0.5),
      CpuShares: tierLimits.CpuShares,
      CpuPeriod: RESOURCE_LIMITS.CONTAINER.CPU_PERIOD,
      CpuQuota: Math.floor(RESOURCE_LIMITS.CONTAINER.CPU_QUOTA * (tierLimits.CpuShares / 1024)),
      SecurityOpt: RESOURCE_LIMITS.CONTAINER.SECURITY_OPT,
      ReadonlyRootfs: false,
      Ulimits: RESOURCE_LIMITS.CONTAINER.ULIMITS,
      Tmpfs: RESOURCE_LIMITS.CONTAINER.TMPFS,
      Privileged: false,
      PidsLimit: 100,
      OomKillDisable: false,
      RestartPolicy: { Name: 'no' }
    };

    return {
      name: `sandbox-${sandboxId}`,
      HostConfig: hostConfig,
      WorkingDir: '/app',
      Env: [
        `ORCHESTRATOR_URL=ws://${process.env.ORCHESTRATOR_HOST}:${process.env.WS_PORT}`,
        `AGENT_TOKEN=${agentToken}`,
        `SANDBOX_ID=${sandboxId}`,
        `MEMORY_LIMIT_MB=${tierInfo.maxMemoryMB}`,
        `CPU_SHARES=${tierInfo.maxCpuShares}`,
        `SANDBOX_TIER=${userTier}`
      ],
      NetworkDisabled: false,
      Tty: false,
      OpenStdin: true,
      StdinOnce: false,
      Labels: {
        'insien.sandbox.id': sandboxId,
        'insien.sandbox.tier': userTier,
        'insien.sandbox.created': new Date().toISOString(),
        'insien.sandbox.version': process.env.npm_package_version || '1.0.0'
      }
    };
  }

  async getContainerStats(containerId: string): Promise<ContainerStats | null> {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 0;
      const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
      const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

      return {
        memory: {
          usage: memoryUsage,
          limit: memoryLimit,
          percent: Math.round(memoryPercent * 100) / 100
        },
        cpu: {
          percent: Math.round(cpuPercent * 100) / 100
        },
        network: {
          rx_bytes: stats.networks?.eth0?.rx_bytes || 0,
          tx_bytes: stats.networks?.eth0?.tx_bytes || 0
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error getting container stats:', error);
      return null;
    }
  }

  async checkResourceViolation(
    _sandboxId: string,
    containerId: string,
    _userTier: UserTier = 'free'
  ): Promise<ViolationResult> {
    const stats = await this.getContainerStats(containerId);
    if (!stats) return { violation: false, violations: [] };

    const violations: ResourceViolation[] = [];

    if (stats.memory.percent > 95) {
      violations.push({
        type: 'memory',
        severity: 'critical',
        message: `Memory usage ${stats.memory.percent}% exceeds critical threshold`
      });
    } else if (stats.memory.percent > 90) {
      violations.push({
        type: 'memory',
        severity: 'warning',
        message: `Memory usage ${stats.memory.percent}% exceeds warning threshold`
      });
    }

    if (stats.cpu.percent > 90) {
      violations.push({
        type: 'cpu',
        severity: 'warning',
        message: `CPU usage ${stats.cpu.percent}% is high`
      });
    }

    return {
      violation: violations.length > 0,
      violations,
      stats
    };
  }

  async cleanupExpiredSandboxes(): Promise<number> {
    try {
      const expiredQuery = `
        SELECT id, metadata
        FROM sandboxes
        WHERE status = 'active'
        AND created_at < NOW() - INTERVAL '${RESOURCE_LIMITS.USER.SANDBOX_LIFETIME_HOURS} hours'
      `;

      const expiredSandboxes = await this.pool.query(expiredQuery);

      for (const sandbox of expiredSandboxes.rows) {
        try {
          const metadata = await getSandboxMetadata(sandbox.id as string);
          if (metadata && metadata.containerId) {
            const container = this.docker.getContainer(metadata.containerId);
            await container.stop({ t: 10 });
            await container.remove();
          }

          await this.pool.query(
            'UPDATE sandboxes SET status = $1, destroyed_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['expired', sandbox.id]
          );

          logger.info(`Cleaned up expired sandbox: ${sandbox.id}`);
        } catch (error) {
          logger.error(`Error cleaning up sandbox ${sandbox.id}:`, error);
        }
      }

      return expiredSandboxes.rows.length;
    } catch (error) {
      logger.error('Error during cleanup:', error);
      return 0;
    }
  }

  async getSystemStats(): Promise<SystemStats> {
    try {
      const containers = await this.docker.listContainers({
        filters: { label: ['insien.sandbox.id'] }
      });

      let totalMemory = 0;
      let totalCpu = 0;

      for (const containerInfo of containers) {
        const stats = await this.getContainerStats(containerInfo.Id);
        if (stats) {
          totalMemory += stats.memory.usage;
          totalCpu += stats.cpu.percent;
        }
      }

      this.systemStats = {
        totalContainers: containers.length,
        totalMemoryUsage: totalMemory,
        totalCpuUsage: totalCpu,
        lastUpdated: new Date().toISOString()
      };

      return this.systemStats;
    } catch (error) {
      logger.error('Error getting system stats:', error);
      return this.systemStats;
    }
  }

  getTierLimits(tier: UserTier): TierLimits {
    return getTierLimits(tier);
  }

  startMonitoring(): void {
    setInterval(() => {
      this.cleanupExpiredSandboxes().catch((error) => {
        logger.error('Cleanup error:', error);
      });
    }, RESOURCE_LIMITS.SYSTEM.CLEANUP_INTERVAL_MINUTES * 60 * 1000);

    setInterval(() => {
      this.getSystemStats().catch((error) => {
        logger.error('Stats update error:', error);
      });
    }, 5 * 60 * 1000);

    logger.info('Resource monitoring started');
  }
}
