import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = createClient({
  url: REDIS_URL
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis connected'));

// Connect on import (will be called when module loads)
let connected = false;
export async function connectRedis() {
  if (!connected) {
    await redisClient.connect();
    connected = true;
  }
}

// Agent connections storage
export async function setAgentConnection(sandboxId, connectionData) {
  await redisClient.setEx(
    `agent:${sandboxId}`,
    3600, // 1 hour TTL
    JSON.stringify(connectionData)
  );
}

export async function getAgentConnection(sandboxId) {
  const data = await redisClient.get(`agent:${sandboxId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteAgentConnection(sandboxId) {
  await redisClient.del(`agent:${sandboxId}`);
}

// Sandbox metadata storage
export async function setSandboxMetadata(sandboxId, metadata) {
  await redisClient.setEx(
    `sandbox:${sandboxId}`,
    86400, // 24 hours TTL
    JSON.stringify(metadata)
  );
}

export async function getSandboxMetadata(sandboxId) {
  const data = await redisClient.get(`sandbox:${sandboxId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteSandboxMetadata(sandboxId) {
  await redisClient.del(`sandbox:${sandboxId}`);
}

// Port mappings storage
export async function setPortMapping(hostPort, sandboxId) {
  await redisClient.setEx(`port:${hostPort}`, 86400, sandboxId);
}

export async function getPortMapping(hostPort) {
  return await redisClient.get(`port:${hostPort}`);
}

export async function deletePortMapping(hostPort) {
  await redisClient.del(`port:${hostPort}`);
}

// Cleanup helper
export async function cleanupSandbox(sandboxId) {
  await Promise.all([
    deleteAgentConnection(sandboxId),
    deleteSandboxMetadata(sandboxId)
  ]);
}

