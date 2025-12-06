import { createClient, RedisClientType } from 'redis';
import type { SandboxMetadata } from '../types/index.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient: RedisClientType = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis connected'));

let connected = false;

export async function connectRedis(): Promise<void> {
  if (!connected) {
    await redisClient.connect();
    connected = true;
  }
}

interface AgentConnectionData {
  connectedAt: string;
  userId?: string;
  tier?: string;
}

export async function setAgentConnection(sandboxId: string, connectionData: AgentConnectionData): Promise<void> {
  await redisClient.setEx(`agent:${sandboxId}`, 3600, JSON.stringify(connectionData));
}

export async function getAgentConnection(sandboxId: string): Promise<AgentConnectionData | null> {
  const data = await redisClient.get(`agent:${sandboxId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteAgentConnection(sandboxId: string): Promise<void> {
  await redisClient.del(`agent:${sandboxId}`);
}

export async function setSandboxMetadata(sandboxId: string, metadata: SandboxMetadata): Promise<void> {
  await redisClient.setEx(`sandbox:${sandboxId}`, 86400, JSON.stringify(metadata));
}

export async function getSandboxMetadata(sandboxId: string): Promise<SandboxMetadata | null> {
  const data = await redisClient.get(`sandbox:${sandboxId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteSandboxMetadata(sandboxId: string): Promise<void> {
  await redisClient.del(`sandbox:${sandboxId}`);
}

export async function setPortMapping(hostPort: number, sandboxId: string): Promise<void> {
  await redisClient.setEx(`port:${hostPort}`, 86400, sandboxId);
}

export async function getPortMapping(hostPort: number): Promise<string | null> {
  return await redisClient.get(`port:${hostPort}`);
}

export async function deletePortMapping(hostPort: number): Promise<void> {
  await redisClient.del(`port:${hostPort}`);
}

export async function cleanupSandbox(sandboxId: string): Promise<void> {
  await Promise.all([
    deleteAgentConnection(sandboxId),
    deleteSandboxMetadata(sandboxId)
  ]);
}
