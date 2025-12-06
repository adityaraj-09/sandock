import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export type PackageManager = 'npm' | 'pip' | 'cargo' | 'go' | 'composer';

export interface PackageInstallOptions {
  packages: string[];
  manager?: PackageManager;
  dev?: boolean;
  global?: boolean;
  directory?: string;
}

export interface PackageInstallResult {
  success: boolean;
  installed: string[];
  failed: string[];
  stdout: string;
  stderr: string;
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

const LANGUAGE_TO_MANAGER: Record<string, PackageManager> = {
  javascript: 'npm',
  typescript: 'npm',
  python: 'pip',
  rust: 'cargo',
  go: 'go',
  php: 'composer'
};

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
      reject(new Error('Package install timeout'));
    }, 300000);

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

export function detectPackageManager(language: string): PackageManager {
  return LANGUAGE_TO_MANAGER[language.toLowerCase()] || 'npm';
}

export async function installPackages(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
  sandboxId: string,
  options: PackageInstallOptions
): Promise<PackageInstallResult> {
  const { packages, manager = 'npm', dev = false, global = false, directory = '/app' } = options;

  if (packages.length === 0) {
    return {
      success: true,
      installed: [],
      failed: [],
      stdout: '',
      stderr: ''
    };
  }

  const { cmd, args } = buildInstallCommand(manager, packages, { dev, global });

  logger.info(`Installing packages with ${manager}: ${packages.join(', ')}`);

  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd,
      args,
      cwd: directory
    });

    const success = response.exitCode === 0;

    return {
      success,
      installed: success ? packages : [],
      failed: success ? [] : packages,
      stdout: response.stdout || '',
      stderr: response.stderr || '',
      error: success ? undefined : response.stderr
    };
  } catch (error) {
    const err = error as Error;
    logger.error('Package install error:', err);
    return {
      success: false,
      installed: [],
      failed: packages,
      stdout: '',
      stderr: '',
      error: err.message
    };
  }
}

function buildInstallCommand(
  manager: PackageManager,
  packages: string[],
  options: { dev: boolean; global: boolean }
): { cmd: string; args: string[] } {
  switch (manager) {
    case 'npm':
      return {
        cmd: 'npm',
        args: [
          'install',
          ...(options.dev ? ['--save-dev'] : []),
          ...(options.global ? ['-g'] : []),
          ...packages
        ]
      };

    case 'pip':
      return {
        cmd: 'pip',
        args: ['install', ...packages]
      };

    case 'cargo':
      return {
        cmd: 'cargo',
        args: ['add', ...packages]
      };

    case 'go':
      return {
        cmd: 'go',
        args: ['get', ...packages]
      };

    case 'composer':
      return {
        cmd: 'composer',
        args: [
          'require',
          ...(options.dev ? ['--dev'] : []),
          ...packages
        ]
      };

    default:
      return {
        cmd: 'npm',
        args: ['install', ...packages]
      };
  }
}

export async function uninstallPackages(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
  sandboxId: string,
  packages: string[],
  manager: PackageManager = 'npm',
  directory: string = '/app'
): Promise<PackageInstallResult> {
  const { cmd, args } = buildUninstallCommand(manager, packages);

  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd,
      args,
      cwd: directory
    });

    const success = response.exitCode === 0;

    return {
      success,
      installed: [],
      failed: success ? [] : packages,
      stdout: response.stdout || '',
      stderr: response.stderr || '',
      error: success ? undefined : response.stderr
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      installed: [],
      failed: packages,
      stdout: '',
      stderr: '',
      error: err.message
    };
  }
}

function buildUninstallCommand(
  manager: PackageManager,
  packages: string[]
): { cmd: string; args: string[] } {
  switch (manager) {
    case 'npm':
      return { cmd: 'npm', args: ['uninstall', ...packages] };

    case 'pip':
      return { cmd: 'pip', args: ['uninstall', '-y', ...packages] };

    case 'cargo':
      return { cmd: 'cargo', args: ['remove', ...packages] };

    case 'go':
      return { cmd: 'go', args: ['mod', 'tidy'] };

    case 'composer':
      return { cmd: 'composer', args: ['remove', ...packages] };

    default:
      return { cmd: 'npm', args: ['uninstall', ...packages] };
  }
}

export async function listInstalledPackages(
  agentWs: WebSocket,
  pendingRequests: Map<string, Map<string, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>>,
  sandboxId: string,
  manager: PackageManager = 'npm',
  directory: string = '/app'
): Promise<{ success: boolean; packages: string[]; error?: string }> {
  const { cmd, args } = buildListCommand(manager);

  try {
    const response = await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
      type: 'exec',
      cmd,
      args,
      cwd: directory
    });

    if (response.exitCode !== 0) {
      return {
        success: false,
        packages: [],
        error: response.stderr
      };
    }

    const packages = parsePackageList(manager, response.stdout || '');

    return {
      success: true,
      packages
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      packages: [],
      error: err.message
    };
  }
}

function buildListCommand(manager: PackageManager): { cmd: string; args: string[] } {
  switch (manager) {
    case 'npm':
      return { cmd: 'npm', args: ['list', '--depth=0', '--json'] };

    case 'pip':
      return { cmd: 'pip', args: ['list', '--format=json'] };

    case 'cargo':
      return { cmd: 'cargo', args: ['tree', '--depth=1'] };

    case 'go':
      return { cmd: 'go', args: ['list', '-m', 'all'] };

    case 'composer':
      return { cmd: 'composer', args: ['show', '--format=json'] };

    default:
      return { cmd: 'npm', args: ['list', '--depth=0'] };
  }
}

function parsePackageList(manager: PackageManager, output: string): string[] {
  try {
    switch (manager) {
      case 'npm': {
        const data = JSON.parse(output);
        return Object.keys(data.dependencies || {});
      }

      case 'pip': {
        const data = JSON.parse(output);
        return data.map((p: { name: string }) => p.name);
      }

      case 'composer': {
        const data = JSON.parse(output);
        return data.installed?.map((p: { name: string }) => p.name) || [];
      }

      default:
        return output.split('\n').filter(Boolean);
    }
  } catch {
    return output.split('\n').filter(Boolean);
  }
}
