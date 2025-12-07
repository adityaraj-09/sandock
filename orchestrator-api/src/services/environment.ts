import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';

interface RPCResponse {
  id: string;
  type: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

type PendingRequests = Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>;

function sendRPCRequest(
  agentWs: WebSocket,
  pendingRequests: PendingRequests,
  sandboxId: string,
  request: object
): Promise<RPCResponse> {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const fullRequest = { id, ...request };

    if (!pendingRequests.has(sandboxId)) {
      pendingRequests.set(sandboxId, new Map());
    }

    const timeout = setTimeout(() => {
      pendingRequests.get(sandboxId)?.delete(id);
      reject(new Error('Request timeout'));
    }, 30000);

    pendingRequests.get(sandboxId)!.set(id, {
      resolve: (response: RPCResponse) => {
        clearTimeout(timeout);
        resolve(response);
      },
      reject: (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });

    agentWs.send(JSON.stringify(fullRequest));
  });
}

export async function storeSandboxEnv(
  sandboxId: string,
  env: Record<string, string>
): Promise<void> {
  await redisClient.hSet(`sandbox:${sandboxId}:env`, env);
  await redisClient.expire(`sandbox:${sandboxId}:env`, 86400 * 7);
  logger.debug(`Stored ${Object.keys(env).length} env vars for sandbox ${sandboxId}`);
}

export async function getSandboxEnv(sandboxId: string): Promise<Record<string, string>> {
  return await redisClient.hGetAll(`sandbox:${sandboxId}:env`);
}

export async function updateSandboxEnv(
  sandboxId: string,
  env: Record<string, string>
): Promise<void> {
  const existing = await getSandboxEnv(sandboxId);
  const merged = { ...existing, ...env };
  await storeSandboxEnv(sandboxId, merged);
}

export async function deleteSandboxEnvKeys(
  sandboxId: string,
  keys: string[]
): Promise<void> {
  if (keys.length > 0) {
    await redisClient.hDel(`sandbox:${sandboxId}:env`, keys);
  }
}

export async function clearSandboxEnv(sandboxId: string): Promise<void> {
  await redisClient.del(`sandbox:${sandboxId}:env`);
}

export async function setEnvInContainer(
  agentWs: WebSocket,
  pendingRequests: PendingRequests,
  sandboxId: string,
  env: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const exports = Object.entries(env)
      .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
      .join(' && ');

    const profileContent = Object.entries(env)
      .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
      .join('\n');

    await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'write',
      path: '/app/.env.sandbox',
      content: profileContent
    });

    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd: 'sh',
      args: ['-c', `${exports} && echo "ENV_SET_OK"`]
    });

    await storeSandboxEnv(sandboxId, env);

    return { success: response.exitCode === 0 };
  } catch (error) {
    const err = error as Error;
    logger.error('Error setting env in container:', err);
    return { success: false, error: err.message };
  }
}

export async function getEnvFromContainer(
  agentWs: WebSocket,
  pendingRequests: PendingRequests,
  sandboxId: string
): Promise<{ success: boolean; env?: Record<string, string>; error?: string }> {
  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd: 'env',
      args: []
    });

    if (response.exitCode !== 0) {
      return { success: false, error: response.stderr };
    }

    const env: Record<string, string> = {};
    const lines = (response.stdout || '').split('\n');

    for (const line of lines) {
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0) {
        const key = line.slice(0, eqIndex);
        const value = line.slice(eqIndex + 1);
        env[key] = value;
      }
    }

    return { success: true, env };
  } catch (error) {
    const err = error as Error;
    logger.error('Error getting env from container:', err);
    return { success: false, error: err.message };
  }
}

export function buildEnvArray(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

export function parseEnvArray(envArray: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const item of envArray) {
    const eqIndex = item.indexOf('=');
    if (eqIndex > 0) {
      env[item.slice(0, eqIndex)] = item.slice(eqIndex + 1);
    }
  }
  return env;
}
