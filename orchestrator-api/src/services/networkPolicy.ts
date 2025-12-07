import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';

export interface NetworkPolicy {
  allowedDomains: string[];
  blockedDomains: string[];
  allowOutbound: boolean;
  allowInbound: boolean;
  maxBandwidthMbps?: number;
  allowedPorts?: number[];
  blockedPorts?: number[];
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  allowedDomains: ['*'],
  blockedDomains: [],
  allowOutbound: true,
  allowInbound: true,
  allowedPorts: [],
  blockedPorts: []
};

export const RESTRICTED_NETWORK_POLICY: NetworkPolicy = {
  allowedDomains: [
    'registry.npmjs.org',
    'pypi.org',
    'files.pythonhosted.org',
    'crates.io',
    'static.crates.io',
    'proxy.golang.org',
    'sum.golang.org',
    'github.com',
    'api.github.com',
    'raw.githubusercontent.com'
  ],
  blockedDomains: [],
  allowOutbound: true,
  allowInbound: false,
  allowedPorts: [80, 443],
  blockedPorts: [22, 23, 25, 3389]
};

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

export async function storeNetworkPolicy(
  sandboxId: string,
  policy: NetworkPolicy
): Promise<void> {
  await redisClient.set(
    `sandbox:${sandboxId}:network_policy`,
    JSON.stringify(policy),
    { EX: 86400 * 7 }
  );
  logger.debug(`Stored network policy for sandbox ${sandboxId}`);
}

export async function getNetworkPolicy(sandboxId: string): Promise<NetworkPolicy | null> {
  const policy = await redisClient.get(`sandbox:${sandboxId}:network_policy`);
  if (!policy) return null;
  return JSON.parse(policy) as NetworkPolicy;
}

export async function deleteNetworkPolicy(sandboxId: string): Promise<void> {
  await redisClient.del(`sandbox:${sandboxId}:network_policy`);
}

export async function applyNetworkPolicy(
  agentWs: WebSocket,
  pendingRequests: PendingRequests,
  sandboxId: string,
  policy: NetworkPolicy
): Promise<{ success: boolean; error?: string }> {
  try {
    const rules: string[] = [];

    if (!policy.allowOutbound) {
      rules.push('iptables -P OUTPUT DROP 2>/dev/null || true');
      rules.push('iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true');
      rules.push('iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true');
    }

    if (policy.blockedPorts && policy.blockedPorts.length > 0) {
      for (const port of policy.blockedPorts) {
        rules.push(`iptables -A OUTPUT -p tcp --dport ${port} -j DROP 2>/dev/null || true`);
        rules.push(`iptables -A OUTPUT -p udp --dport ${port} -j DROP 2>/dev/null || true`);
      }
    }

    if (policy.blockedDomains.length > 0 && !policy.blockedDomains.includes('*')) {
      const hostsEntries = policy.blockedDomains
        .map((domain) => `0.0.0.0 ${domain}`)
        .join('\n');

      await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
        type: 'exec',
        cmd: 'sh',
        args: ['-c', `echo "${hostsEntries}" >> /etc/hosts 2>/dev/null || true`]
      });
    }

    if (rules.length > 0) {
      const script = rules.join(' && ');
      await sendRPCRequest(agentWs, pendingRequests, sandboxId, {
        type: 'exec',
        cmd: 'sh',
        args: ['-c', script]
      });
    }

    await storeNetworkPolicy(sandboxId, policy);

    logger.info(`Applied network policy to sandbox ${sandboxId}`);
    return { success: true };
  } catch (error) {
    const err = error as Error;
    logger.error('Error applying network policy:', err);
    return { success: false, error: err.message };
  }
}

export function validateNetworkPolicy(policy: Partial<NetworkPolicy>): NetworkPolicy {
  return {
    allowedDomains: policy.allowedDomains || DEFAULT_NETWORK_POLICY.allowedDomains,
    blockedDomains: policy.blockedDomains || DEFAULT_NETWORK_POLICY.blockedDomains,
    allowOutbound: policy.allowOutbound ?? DEFAULT_NETWORK_POLICY.allowOutbound,
    allowInbound: policy.allowInbound ?? DEFAULT_NETWORK_POLICY.allowInbound,
    maxBandwidthMbps: policy.maxBandwidthMbps,
    allowedPorts: policy.allowedPorts || DEFAULT_NETWORK_POLICY.allowedPorts,
    blockedPorts: policy.blockedPorts || DEFAULT_NETWORK_POLICY.blockedPorts
  };
}

export function getDockerNetworkConfig(policy: NetworkPolicy): {
  NetworkDisabled: boolean;
  NetworkMode: string;
} {
  if (!policy.allowOutbound && !policy.allowInbound) {
    return {
      NetworkDisabled: true,
      NetworkMode: 'none'
    };
  }

  return {
    NetworkDisabled: false,
    NetworkMode: 'bridge'
  };
}

export function isDomainAllowed(domain: string, policy: NetworkPolicy): boolean {
  if (policy.blockedDomains.includes(domain) || policy.blockedDomains.includes('*')) {
    return false;
  }

  if (policy.allowedDomains.includes('*')) {
    return true;
  }

  return policy.allowedDomains.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1);
      return domain.endsWith(suffix) || domain === allowed.slice(2);
    }
    return domain === allowed;
  });
}
