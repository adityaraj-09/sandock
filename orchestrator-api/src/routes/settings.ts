import { Router, Response } from 'express';
import { WebSocket } from 'ws';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';
import { logger } from '../utils/logger.js';
import {
  createSecret,
  listSecrets,
  deleteSecret,
  injectSecretsToSandbox,
  getSandboxSecrets
} from '../services/secrets.js';
import {
  setEnvInContainer,
  getEnvFromContainer,
  getSandboxEnv,
  updateSandboxEnv,
  deleteSandboxEnvKeys
} from '../services/environment.js';
import {
  applyNetworkPolicy,
  getNetworkPolicy,
  validateNetworkPolicy,
  DEFAULT_NETWORK_POLICY,
  RESTRICTED_NETWORK_POLICY
} from '../services/networkPolicy.js';
import type { AuthenticatedRequest } from '../types/index.js';

interface SettingsRouterDependencies {
  agentConnections: Map<string, WebSocket>;
}

type PendingRequests = Map<string, Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>>;

export default function createSettingsRouter(dependencies: SettingsRouterDependencies) {
  const { agentConnections } = dependencies;
  const router = Router();
  const pendingRequests: PendingRequests = new Map();

  router.post('/secrets', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { name, value } = req.body;

      if (!name || !value) {
        res.status(400).json({ error: 'name and value are required' });
        return;
      }

      const secret = await createSecret(userId, name, value);
      res.status(201).json({ success: true, secret: { id: secret.id, name: secret.name } });
    } catch (error) {
      logger.error('Error creating secret:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/secrets', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const secrets = await listSecrets(userId);
      res.json({ success: true, secrets });
    } catch (error) {
      logger.error('Error listing secrets:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/secrets/:name', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { name } = req.params;

      const deleted = await deleteSecret(userId, name);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Secret not found' });
      }
    } catch (error) {
      logger.error('Error deleting secret:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/sandbox/:id/secrets', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { id: sandboxId } = req.params;
      const { secrets } = req.body;

      if (!secrets || typeof secrets !== 'object') {
        res.status(400).json({ error: 'secrets object is required' });
        return;
      }

      await injectSecretsToSandbox(sandboxId, userId, secrets);
      res.json({ success: true, injected: Object.keys(secrets).length });
    } catch (error) {
      logger.error('Error injecting secrets:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/sandbox/:id/secrets', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id: sandboxId } = req.params;
      const secrets = await getSandboxSecrets(sandboxId);
      res.json({ success: true, secrets: Object.keys(secrets) });
    } catch (error) {
      logger.error('Error getting sandbox secrets:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/sandbox/:id/env', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id: sandboxId } = req.params;
      const { env } = req.body;

      if (!env || typeof env !== 'object') {
        res.status(400).json({ error: 'env object is required' });
        return;
      }

      const agentWs = agentConnections.get(sandboxId);
      if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
        await updateSandboxEnv(sandboxId, env);
        res.json({ success: true, stored: true, applied: false });
        return;
      }

      const result = await setEnvInContainer(agentWs, pendingRequests as never, sandboxId, env);
      res.json(result);
    } catch (error) {
      logger.error('Error setting env:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/sandbox/:id/env', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id: sandboxId } = req.params;
      const { source } = req.query;

      if (source === 'container') {
        const agentWs = agentConnections.get(sandboxId);
        if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
          res.status(400).json({ error: 'Agent not connected' });
          return;
        }
        const result = await getEnvFromContainer(agentWs, pendingRequests as never, sandboxId);
        res.json(result);
      } else {
        const env = await getSandboxEnv(sandboxId);
        res.json({ success: true, env });
      }
    } catch (error) {
      logger.error('Error getting env:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/sandbox/:id/env', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id: sandboxId } = req.params;
      const { keys } = req.body;

      if (!keys || !Array.isArray(keys)) {
        res.status(400).json({ error: 'keys array is required' });
        return;
      }

      await deleteSandboxEnvKeys(sandboxId, keys);
      res.json({ success: true, deleted: keys.length });
    } catch (error) {
      logger.error('Error deleting env keys:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/sandbox/:id/network-policy', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id: sandboxId } = req.params;
      const { policy, preset } = req.body;

      let finalPolicy;
      if (preset === 'restricted') {
        finalPolicy = RESTRICTED_NETWORK_POLICY;
      } else if (preset === 'default') {
        finalPolicy = DEFAULT_NETWORK_POLICY;
      } else if (policy) {
        finalPolicy = validateNetworkPolicy(policy);
      } else {
        res.status(400).json({ error: 'policy object or preset is required' });
        return;
      }

      const agentWs = agentConnections.get(sandboxId);
      if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
        res.status(400).json({ error: 'Agent not connected' });
        return;
      }

      const result = await applyNetworkPolicy(agentWs, pendingRequests as never, sandboxId, finalPolicy);
      res.json({ ...result, policy: finalPolicy });
    } catch (error) {
      logger.error('Error applying network policy:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/sandbox/:id/network-policy', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { id: sandboxId } = req.params;
      const policy = await getNetworkPolicy(sandboxId);
      res.json({ success: true, policy: policy || DEFAULT_NETWORK_POLICY });
    } catch (error) {
      logger.error('Error getting network policy:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
