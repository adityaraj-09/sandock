// Resource limits and quotas configuration
export const RESOURCE_LIMITS = {
  // Container resource limits
  CONTAINER: {
    // Memory limits (in bytes)
    MEMORY: parseInt(process.env.CONTAINER_MEMORY_LIMIT) || 512 * 1024 * 1024, // 512MB default
    MEMORY_SWAP: parseInt(process.env.CONTAINER_MEMORY_SWAP) || 512 * 1024 * 1024, // Same as memory (no swap)
    
    // CPU limits
    CPU_SHARES: parseInt(process.env.CONTAINER_CPU_SHARES) || 512, // Relative weight
    CPU_PERIOD: parseInt(process.env.CONTAINER_CPU_PERIOD) || 100000, // 100ms
    CPU_QUOTA: parseInt(process.env.CONTAINER_CPU_QUOTA) || 50000, // 50% of one core
    
    // Disk limits
    STORAGE_OPT: {
      size: process.env.CONTAINER_STORAGE_SIZE || '1G' // 1GB disk limit
    },
    
    // Network limits
    ULIMITS: [
      {
        Name: 'nofile',
        Soft: 1024,
        Hard: 2048
      },
      {
        Name: 'nproc',
        Soft: 512,
        Hard: 1024
      }
    ],
    
    // Security options
    SECURITY_OPT: [
      'no-new-privileges:true'
    ],
    
    // Read-only root filesystem
    READ_ONLY_ROOT_FS: true,
    
    // Tmpfs mounts for writable directories
    TMPFS: {
      '/tmp': 'rw,noexec,nosuid,size=100m',
      '/var/tmp': 'rw,noexec,nosuid,size=50m'
    }
  },
  
  // User quotas
  USER: {
    MAX_SANDBOXES_PER_USER: parseInt(process.env.MAX_SANDBOXES_PER_USER) || 5,
    MAX_SANDBOXES_PER_API_KEY: parseInt(process.env.MAX_SANDBOXES_PER_API_KEY) || 3,
    SANDBOX_LIFETIME_HOURS: parseInt(process.env.SANDBOX_LIFETIME_HOURS) || 24,
    MAX_EXPOSED_PORTS_PER_SANDBOX: parseInt(process.env.MAX_EXPOSED_PORTS) || 5
  },
  
  // System limits
  SYSTEM: {
    MAX_TOTAL_SANDBOXES: parseInt(process.env.MAX_TOTAL_SANDBOXES) || 100,
    CLEANUP_INTERVAL_MINUTES: parseInt(process.env.CLEANUP_INTERVAL_MINUTES) || 15,
    STALE_CONNECTION_TIMEOUT_MINUTES: parseInt(process.env.STALE_CONNECTION_TIMEOUT) || 30,
    CONTAINER_STARTUP_TIMEOUT_SECONDS: parseInt(process.env.CONTAINER_STARTUP_TIMEOUT) || 60
  }
};

// Tier-based limits (for future premium features)
export const TIER_LIMITS = {
  free: {
    maxSandboxes: 2,
    maxMemoryMB: 256,
    maxCpuShares: 256,
    lifetimeHours: 2
  },
  pro: {
    maxSandboxes: 10,
    maxMemoryMB: 1024,
    maxCpuShares: 1024,
    lifetimeHours: 24
  },
  enterprise: {
    maxSandboxes: 50,
    maxMemoryMB: 2048,
    maxCpuShares: 2048,
    lifetimeHours: 168 // 1 week
  }
};

export function getTierLimits(tier = 'free') {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

export function getResourceLimitsForTier(tier = 'free') {
  const tierLimits = getTierLimits(tier);
  
  return {
    Memory: tierLimits.maxMemoryMB * 1024 * 1024,
    MemorySwap: tierLimits.maxMemoryMB * 1024 * 1024,
    CpuShares: tierLimits.maxCpuShares,
    CpuPeriod: RESOURCE_LIMITS.CONTAINER.CPU_PERIOD,
    CpuQuota: Math.floor(RESOURCE_LIMITS.CONTAINER.CPU_QUOTA * (tierLimits.maxCpuShares / 1024))
  };
}
