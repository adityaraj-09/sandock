import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export interface GitCloneOptions {
  url: string;
  branch?: string;
  depth?: number;
  directory?: string;
}

export interface GitCloneResult {
  success: boolean;
  directory: string;
  branch: string;
  error?: string;
}

interface RPCResponse {
  id: string;
  type: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

function sendRPCRequest(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
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
    }, 120000);

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

export async function cloneRepository(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
  sandboxId: string,
  options: GitCloneOptions
): Promise<GitCloneResult> {
  const { url, branch, depth, directory } = options;

  const repoName = directory || extractRepoName(url);
  const targetDir = `/app/${repoName}`;

  const args = ['clone'];

  if (branch) {
    args.push('--branch', branch);
  }

  if (depth) {
    args.push('--depth', depth.toString());
  }

  args.push(url, targetDir);

  logger.info(`Cloning repository: ${url} to ${targetDir}`);

  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd: 'git',
      args
    });

    if (response.exitCode !== 0) {
      return {
        success: false,
        directory: targetDir,
        branch: branch || 'main',
        error: response.stderr || 'Git clone failed'
      };
    }

    const actualBranch = await getCurrentBranch(agentWs, pendingRequests, sandboxId, targetDir);

    return {
      success: true,
      directory: targetDir,
      branch: actualBranch
    };
  } catch (error) {
    const err = error as Error;
    logger.error('Git clone error:', err);
    return {
      success: false,
      directory: targetDir,
      branch: branch || 'main',
      error: err.message
    };
  }
}

async function getCurrentBranch(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
  sandboxId: string,
  directory: string
): Promise<string> {
  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd: 'git',
      args: ['-C', directory, 'rev-parse', '--abbrev-ref', 'HEAD']
    });

    if (response.exitCode === 0 && response.stdout) {
      return response.stdout.trim();
    }
  } catch {
    logger.warn('Could not determine current branch');
  }

  return 'main';
}

export async function pullRepository(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
  sandboxId: string,
  directory: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd: 'git',
      args: ['-C', directory, 'pull']
    });

    if (response.exitCode !== 0) {
      return {
        success: false,
        error: response.stderr || 'Git pull failed'
      };
    }

    return { success: true };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message
    };
  }
}

export async function checkoutBranch(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
  sandboxId: string,
  directory: string,
  branch: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd: 'git',
      args: ['-C', directory, 'checkout', branch]
    });

    if (response.exitCode !== 0) {
      return {
        success: false,
        error: response.stderr || 'Git checkout failed'
      };
    }

    return { success: true };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message
    };
  }
}

function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(\.git)?$/);
  return match ? match[1] : 'repo';
}
