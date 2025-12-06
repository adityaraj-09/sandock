import { logger } from '../utils/logger.js';
import type { Docker, ContainerConfig, ResourceViolation } from '../types/index.js';

interface ImageInfo {
  id: string;
  size: number;
  virtualSize: number;
  created: string;
  layers: number;
}

interface CleanupResult {
  imagesRemoved: number;
  spaceFreed: number;
}

interface PullResult {
  image: string;
  status: 'cached' | 'pulled' | 'error';
  error?: string;
}

export class ContainerOptimizer {
  private docker: Docker;
  private _imageCache: Map<string, ImageInfo> = new Map();

  constructor(docker: Docker) {
    this.docker = docker;
  }

  async optimizeAgentImage(baseImage = 'sandbox-agent:latest'): Promise<string> {
    const startTime = Date.now();
    try {
      logger.debug(`[CONTAINER_OPTIMIZER] Optimizing image: ${baseImage}`);
      const optimizedTag = `${baseImage}-optimized`;

      try {
        await this.docker.getImage(optimizedTag).inspect();
        const duration = Date.now() - startTime;
        logger.info(`[CONTAINER_OPTIMIZER] Using cached optimized image: ${optimizedTag} (${duration}ms)`);
        return optimizedTag;
      } catch {
        logger.debug(`[CONTAINER_OPTIMIZER] Optimized image not found, will use base image: ${baseImage}`);
        logger.warn(`[CONTAINER_OPTIMIZER] Skipping optimized image creation, using base image: ${baseImage}`);
        return baseImage;
      }
    } catch (error) {
      logger.error('Error optimizing image:', error);
      return baseImage;
    }
  }

  async getImageInfo(imageName: string): Promise<ImageInfo | null> {
    try {
      const image = this.docker.getImage(imageName);
      const info = await image.inspect();

      return {
        id: info.Id,
        size: info.Size,
        virtualSize: info.VirtualSize,
        created: info.Created,
        layers: info.RootFS?.Layers?.length || 0
      };
    } catch (error) {
      logger.error(`Error getting image info for ${imageName}:`, error);
      return null;
    }
  }

  async cleanupUnusedImages(): Promise<CleanupResult> {
    try {
      const images = await this.docker.listImages();
      const unusedImages: Array<{ Id: string; RepoTags?: string[]; Size?: number }> = [];

      for (const imageInfo of images) {
        const containers = await this.docker.listContainers({
          all: true,
          filters: { ancestor: [imageInfo.Id] }
        });

        if (containers.length === 0 && imageInfo.RepoTags) {
          const isSandboxImage = imageInfo.RepoTags.some(
            (tag) => tag.includes('sandbox-agent') || tag.includes('insien')
          );

          if (isSandboxImage) {
            unusedImages.push(imageInfo);
          }
        }
      }

      let cleanedSize = 0;
      for (const imageInfo of unusedImages) {
        try {
          const image = this.docker.getImage(imageInfo.Id);
          await image.remove({ force: false });
          cleanedSize += imageInfo.Size || 0;
          logger.info(`Removed unused image: ${imageInfo.RepoTags?.[0] || imageInfo.Id}`);
        } catch (error) {
          logger.warn(`Could not remove image ${imageInfo.Id}:`, (error as Error).message);
        }
      }

      return {
        imagesRemoved: unusedImages.length,
        spaceFreed: cleanedSize
      };
    } catch (error) {
      logger.error('Error cleaning up images:', error);
      return { imagesRemoved: 0, spaceFreed: 0 };
    }
  }

  async optimizeContainerStartup(containerConfig: ContainerConfig): Promise<ContainerConfig> {
    logger.debug('[CONTAINER_OPTIMIZER] Optimizing container startup configuration');

    const optimizedConfig: ContainerConfig = {
      ...containerConfig,
      HostConfig: {
        ...containerConfig.HostConfig,
        Dns: ['1.1.1.1', '8.8.8.8'],
        ShmSize: 64 * 1024 * 1024
      },
      Env: [
        ...containerConfig.Env,
        'NODE_ENV=production',
        'NODE_OPTIONS=--max-old-space-size=256',
        'UV_THREADPOOL_SIZE=4'
      ]
    };

    logger.debug('[CONTAINER_OPTIMIZER] Container startup optimization completed');
    return optimizedConfig;
  }

  async prePullImages(images: string[] = ['sandbox-agent:latest']): Promise<PullResult[]> {
    const results: PullResult[] = [];

    for (const imageName of images) {
      try {
        logger.info(`Pre-pulling image: ${imageName}`);

        try {
          await this.docker.getImage(imageName).inspect();
          logger.info(`Image ${imageName} already exists locally`);
          results.push({ image: imageName, status: 'cached' });
          continue;
        } catch {
          // Image doesn't exist, pull it
        }

        const stream = await this.docker.pull(imageName);

        await new Promise<void>((resolve, reject) => {
          this.docker.modem.followProgress(stream, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        logger.info(`Successfully pulled image: ${imageName}`);
        results.push({ image: imageName, status: 'pulled' });
      } catch (error) {
        logger.error(`Error pulling image ${imageName}:`, error);
        results.push({ image: imageName, status: 'error', error: (error as Error).message });
      }
    }

    return results;
  }

  async getOptimizationRecommendations(containerId: string): Promise<ResourceViolation[]> {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      const recommendations: ResourceViolation[] = [];

      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 0;
      const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

      if (memoryPercent > 80) {
        recommendations.push({
          type: 'memory',
          severity: 'high',
          message: 'Container is using high memory. Consider increasing memory limit or optimizing application.'
        });
      } else if (memoryPercent < 20) {
        recommendations.push({
          type: 'memory',
          severity: 'low',
          message: 'Container is using low memory. Consider reducing memory limit to save resources.'
        });
      }

      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
      const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

      if (cpuPercent > 80) {
        recommendations.push({
          type: 'cpu',
          severity: 'high',
          message: 'Container is using high CPU. Consider increasing CPU limits or optimizing application.'
        });
      }

      const networkRx = stats.networks?.eth0?.rx_bytes || 0;
      const networkTx = stats.networks?.eth0?.tx_bytes || 0;
      const totalNetwork = networkRx + networkTx;

      if (totalNetwork > 100 * 1024 * 1024) {
        recommendations.push({
          type: 'network',
          severity: 'medium',
          message: 'Container has high network usage. Monitor for potential issues.'
        });
      }

      return recommendations;
    } catch (error) {
      logger.error('Error getting optimization recommendations:', error);
      return [];
    }
  }

  startOptimizationTasks(): void {
    setInterval(() => {
      this.cleanupUnusedImages().catch((error) => {
        logger.error('Image cleanup error:', error);
      });
    }, 6 * 60 * 60 * 1000);

    setInterval(() => {
      this.prePullImages().catch((error) => {
        logger.error('Image pre-pull error:', error);
      });
    }, 24 * 60 * 60 * 1000);

    logger.info('Container optimization tasks started');
  }
}
