import type { Request } from 'express';
import type WebSocket from 'ws';

// User types
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  imageUrl?: string;
  phoneNumber?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
}

export interface AuthUser {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  imageUrl?: string;
  apiKeyId?: string;
  tier?: UserTier;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

// API Key types
export interface ApiKey {
  id: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface ApiKeyCreateResult {
  id: string;
  key: string;
  prefix: string;
  name: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface ApiKeyValidationResult {
  userId: string;
  apiKeyId: string;
  email: string;
}

// Sandbox types
export type SandboxStatus = 'active' | 'destroyed' | 'expired';
export type UserTier = 'free' | 'pro' | 'enterprise';

export interface Sandbox {
  id: string;
  userId: string;
  apiKeyId: string;
  status: SandboxStatus;
  metadata: SandboxMetadata;
  createdAt: Date;
  destroyedAt?: Date;
}

export interface SandboxMetadata {
  containerId: string;
  containerName?: string;
  userId?: string;
  apiKeyId?: string;
  tier?: UserTier;
  createdAt?: string;
  expiresAt?: string;
  exposedPorts?: Record<number, number>;
  resourceLimits?: ResourceLimits;
  image?: string;
  language?: string;
  execution?: boolean;
  allowUnauthenticated?: boolean;
}

export interface ResourceLimits {
  memory?: number;
  cpu?: number;
  storage?: string;
}

// Container types
export interface ContainerConfig {
  name: string;
  Image?: string;
  Env: string[];
  HostConfig: HostConfig;
  WorkingDir: string;
  NetworkDisabled: boolean;
  Tty: boolean;
  OpenStdin: boolean;
  StdinOnce: boolean;
  Labels: Record<string, string>;
  ExposedPorts?: Record<string, object>;
}

export interface HostConfig {
  NetworkMode: string;
  AutoRemove: boolean;
  Memory: number;
  MemorySwap: number;
  MemoryReservation?: number;
  CpuShares: number;
  CpuPeriod?: number;
  CpuQuota?: number;
  SecurityOpt: string[];
  ReadonlyRootfs: boolean;
  Ulimits: Ulimit[];
  Tmpfs: Record<string, string>;
  Privileged: boolean;
  PidsLimit: number;
  OomKillDisable: boolean;
  RestartPolicy: RestartPolicy;
  StorageOpt?: Record<string, string>;
  PortBindings?: Record<string, PortBinding[]>;
  Binds?: string[];
  ExtraHosts?: string[];
  Dns?: string[];
  ShmSize?: number;
}

export interface Ulimit {
  Name: string;
  Soft: number;
  Hard: number;
}

export interface RestartPolicy {
  Name: string;
}

export interface PortBinding {
  HostPort: string;
}

// Container stats
export interface ContainerStats {
  memory: {
    usage: number;
    limit: number;
    percent: number;
  };
  cpu: {
    percent: number;
  };
  network: {
    rx_bytes: number;
    tx_bytes: number;
  };
  timestamp: string;
}

export interface ResourceViolation {
  type: 'memory' | 'cpu' | 'network';
  severity: 'warning' | 'critical' | 'high' | 'medium' | 'low';
  message: string;
}

// WebSocket types
export interface WSAuthInfo {
  userId?: string;
  apiKeyId?: string;
  method?: string;
  warning?: string;
}

export interface AuthenticatedWebSocket extends WebSocket {
  authInfo?: WSAuthInfo;
}

export interface RPCMessage {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface RPCResponse {
  id: string;
  type: string;
  error?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  success?: boolean;
  path?: string;
  content?: string;
  pid?: number;
  background?: boolean;
}

// Port allocation
export interface PortAllocation {
  sandboxId: string;
  containerPort: number;
  allocatedAt: string;
}

export interface PortStats {
  rangeStart: number;
  rangeEnd: number;
  totalPorts: number;
  allocatedPorts: number;
  availablePorts: number;
}

// Language configuration
export interface LanguageConfig {
  extension: string;
  command: string;
  args: string[];
  compile: boolean;
  runCommand?: string;
  runArgs?: string[];
}

// Tier limits
export interface TierLimits {
  maxSandboxes: number;
  maxMemoryMB: number;
  maxCpuShares: number;
  lifetimeHours: number;
}

export interface TierResourceLimits {
  Memory: number;
  MemorySwap: number;
  CpuShares: number;
  CpuPeriod: number;
  CpuQuota: number;
}

// Container pool
export interface WarmContainer {
  id: string;
  containerId: string;
  language: string;
  createdAt: number;
}

export interface PoolStats {
  enabled: boolean;
  poolSizePerLanguage: number;
  pools: Record<string, {
    size: number;
    target: number;
    containers: Array<{ id: string; age: number }>;
  }>;
}

// Auth verification results
export interface AgentAuthResult {
  valid: boolean;
  error?: string;
  decoded?: JWTPayload;
  userId?: string;
  tier?: UserTier;
}

export interface ClientAuthResult {
  valid: boolean;
  error?: string;
  userId?: string;
  apiKeyId?: string;
  method?: 'api_key' | 'jwt' | 'internal';
  warning?: string;
}

export interface JWTPayload {
  sandboxId: string;
  type: 'agent' | 'warm' | 'client';
  userId?: string;
  tier?: UserTier;
  iat?: number;
  exp?: number;
}

// Sandbox creation
export interface CreateSandboxResult {
  sandboxId: string;
  agentUrl: string;
  tier: UserTier;
  resourceLimits: {
    memoryMB: number;
    cpuShares: number;
    lifetimeHours: number;
  };
  expiresAt: string;
}

// Code execution
export interface CodeExecuteRequest {
  code: string;
  language: string;
  timeout?: number;
  input?: string;
  tier?: UserTier;
}

export interface CodeExecuteResult {
  success: boolean;
  language: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  compileResult?: {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}

// Router dependencies
export interface SandboxRouterDependencies {
  docker: Docker;
  agentConnections: Map<string, WebSocket>;
  pool: PgPool;
  JWT_SECRET: string;
  AGENT_IMAGE: string;
  ORCHESTRATOR_HOST: string;
  WS_PORT: number | string;
  getSandboxMetadata: (sandboxId: string) => Promise<SandboxMetadata | null>;
  setSandboxMetadata: (sandboxId: string, metadata: SandboxMetadata) => Promise<void>;
  deleteAgentConnection: (sandboxId: string) => Promise<void>;
  deletePortMapping: (hostPort: number) => Promise<void>;
  cleanupSandbox: (sandboxId: string) => Promise<void>;
  getPortMapping: (hostPort: number) => Promise<string | null>;
  setPortMapping: (hostPort: number, sandboxId: string) => Promise<void>;
}

// Docker types - use Dockerode directly
import type Dockerode from 'dockerode';
export type Docker = Dockerode;
export type Container = Dockerode.Container;

export interface ContainerInfo {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

export interface ContainerInspectInfo {
  Id: string;
  Name: string;
  State: {
    Running: boolean;
    Status: string;
    ExitCode: number;
    Error: string;
  };
  Config: {
    Env: string[];
    WorkingDir: string;
    Tty: boolean;
    OpenStdin: boolean;
    StdinOnce: boolean;
    Labels: Record<string, string>;
  };
  HostConfig: HostConfig;
}

export interface ContainerStatsResult {
  memory_stats: {
    usage: number;
    limit: number;
  };
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  precpu_stats: {
    cpu_usage?: { total_usage: number };
    system_cpu_usage?: number;
  };
  networks?: {
    eth0?: {
      rx_bytes: number;
      tx_bytes: number;
    };
  };
}

export interface DockerImage {
  inspect(): Promise<ImageInspectInfo>;
  remove(options?: { force?: boolean }): Promise<void>;
}

export interface ImageInfo {
  Id: string;
  RepoTags?: string[];
  Size?: number;
}

export interface ImageInspectInfo {
  Id: string;
  Size: number;
  VirtualSize: number;
  Created: string;
  RootFS?: {
    Layers?: string[];
  };
}

export interface DockerVolume {
  inspect(): Promise<object>;
  remove(): Promise<void>;
}

// PostgreSQL Pool types
export interface PgPool {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

export interface PoolClient {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  release(): void;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

// Message types for WebSocket communication
export interface AgentMessage {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface ClientMessage {
  id: string;
  type: string;
  [key: string]: unknown;
}
