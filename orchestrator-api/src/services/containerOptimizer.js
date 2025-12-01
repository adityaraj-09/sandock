import { logger } from '../utils/logger.js';

export class ContainerOptimizer {
  constructor(docker) {
    this.docker = docker;
    this.imageCache = new Map();
  }

  // Optimize Docker image by building a minimal version
  async optimizeAgentImage(baseImage = 'sandbox-agent:latest') {
    try {
      // Check if optimized image already exists
      const optimizedTag = `${baseImage}-optimized`;
      
      try {
        await this.docker.getImage(optimizedTag).inspect();
        logger.info(`Using cached optimized image: ${optimizedTag}`);
        return optimizedTag;
      } catch (error) {
        // Image doesn't exist, create it
      }

      // Create Dockerfile for optimized image
      const dockerfile = `
FROM ${baseImage} as base

# Multi-stage build for smaller image
FROM node:20-alpine as optimized

# Install only production dependencies
RUN apk add --no-cache \\
    dumb-init \\
    && addgroup -g 1001 -S sandbox \\
    && adduser -S sandbox -u 1001

# Copy only necessary files from base image
COPY --from=base /app/package.json /app/
COPY --from=base /app/src /app/src
COPY --from=base /app/node_modules /app/node_modules

# Set working directory
WORKDIR /app

# Remove unnecessary files
RUN rm -rf /app/node_modules/.cache \\
    && rm -rf /tmp/* \\
    && rm -rf /var/cache/apk/*

# Create workspace directory with proper permissions
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace

# Switch to non-root user
USER sandbox

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node -e "process.exit(0)"

# Labels
LABEL maintainer="insien" \\
      version="optimized" \\
      description="Optimized sandbox agent container"
`;

      // Build optimized image
      const stream = await this.docker.buildImage(
        {
          context: process.cwd(),
          src: ['Dockerfile.optimized']
        },
        {
          t: optimizedTag,
          dockerfile: 'Dockerfile.optimized',
          buildargs: {
            BASE_IMAGE: baseImage
          }
        }
      );

      // Write temporary Dockerfile
      const fs = await import('fs/promises');
      await fs.writeFile('Dockerfile.optimized', dockerfile);

      // Wait for build to complete
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });

      // Clean up temporary file
      await fs.unlink('Dockerfile.optimized');

      logger.info(`Created optimized image: ${optimizedTag}`);
      return optimizedTag;

    } catch (error) {
      logger.error('Error optimizing image:', error);
      return baseImage; // Fall back to original image
    }
  }

  // Get image size information
  async getImageInfo(imageName) {
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

  // Clean up unused images
  async cleanupUnusedImages() {
    try {
      // Get all images
      const images = await this.docker.listImages();
      const unusedImages = [];

      for (const imageInfo of images) {
        // Skip images that are currently in use
        const containers = await this.docker.listContainers({
          all: true,
          filters: { ancestor: [imageInfo.Id] }
        });

        if (containers.length === 0 && imageInfo.RepoTags) {
          // Check if it's a sandbox-related image that's not in use
          const isSandboxImage = imageInfo.RepoTags.some(tag => 
            tag.includes('sandbox-agent') || tag.includes('insien')
          );

          if (isSandboxImage) {
            unusedImages.push(imageInfo);
          }
        }
      }

      // Remove unused images
      let cleanedSize = 0;
      for (const imageInfo of unusedImages) {
        try {
          const image = this.docker.getImage(imageInfo.Id);
          await image.remove({ force: false });
          cleanedSize += imageInfo.Size || 0;
          logger.info(`Removed unused image: ${imageInfo.RepoTags?.[0] || imageInfo.Id}`);
        } catch (error) {
          logger.warn(`Could not remove image ${imageInfo.Id}:`, error.message);
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

  // Optimize container startup
  async optimizeContainerStartup(containerConfig) {
    // Add optimizations for faster startup
    const optimizedConfig = {
      ...containerConfig,
      
      // Faster networking
      HostConfig: {
        ...containerConfig.HostConfig,
        
        // Use faster DNS
        Dns: ['1.1.1.1', '8.8.8.8'],
        
        // Optimize shared memory
        ShmSize: 64 * 1024 * 1024, // 64MB
        
        // Faster I/O
        IOMaximumBandwidth: 10 * 1024 * 1024, // 10MB/s
        IOMaximumIOps: 1000,
      },
      
      // Optimize environment
      Env: [
        ...containerConfig.Env,
        'NODE_ENV=production',
        'NODE_OPTIONS=--max-old-space-size=256', // Limit Node.js memory
        'UV_THREADPOOL_SIZE=4' // Optimize libuv thread pool
      ]
    };

    return optimizedConfig;
  }

  // Pre-pull and cache images
  async prePullImages(images = ['sandbox-agent:latest']) {
    const results = [];

    for (const imageName of images) {
      try {
        logger.info(`Pre-pulling image: ${imageName}`);
        
        // Check if image exists locally
        try {
          await this.docker.getImage(imageName).inspect();
          logger.info(`Image ${imageName} already exists locally`);
          results.push({ image: imageName, status: 'cached' });
          continue;
        } catch (error) {
          // Image doesn't exist, pull it
        }

        // Pull the image
        const stream = await this.docker.pull(imageName);
        
        await new Promise((resolve, reject) => {
          this.docker.modem.followProgress(stream, (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        });

        logger.info(`Successfully pulled image: ${imageName}`);
        results.push({ image: imageName, status: 'pulled' });

      } catch (error) {
        logger.error(`Error pulling image ${imageName}:`, error);
        results.push({ image: imageName, status: 'error', error: error.message });
      }
    }

    return results;
  }

  // Get container optimization recommendations
  async getOptimizationRecommendations(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      const stats = await container.stats({ stream: false });
      
      const recommendations = [];

      // Memory recommendations
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

      // CPU recommendations
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

      // Network recommendations
      const networkRx = stats.networks?.eth0?.rx_bytes || 0;
      const networkTx = stats.networks?.eth0?.tx_bytes || 0;
      const totalNetwork = networkRx + networkTx;

      if (totalNetwork > 100 * 1024 * 1024) { // 100MB
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

  // Start optimization background tasks
  startOptimizationTasks() {
    // Clean up unused images every 6 hours
    setInterval(() => {
      this.cleanupUnusedImages().catch(error => {
        logger.error('Image cleanup error:', error);
      });
    }, 6 * 60 * 60 * 1000);

    // Pre-pull images every 24 hours
    setInterval(() => {
      this.prePullImages().catch(error => {
        logger.error('Image pre-pull error:', error);
      });
    }, 24 * 60 * 60 * 1000);

    logger.info('Container optimization tasks started');
  }
}
