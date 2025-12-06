import { Router, Response } from 'express';
import { requireAuth } from '../services/auth.js';
import { createApiKey, getUserApiKeys, revokeApiKey } from '../services/apiKeys.js';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

router.use(requireAuth());

router.post('/', async (req, res: Response): Promise<void> => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(255).optional(),
      expiresInDays: z.number().int().positive().optional()
    });

    const { name, expiresInDays } = schema.parse(req.body);
    const userId = (req as AuthenticatedRequest).user.userId;

    const apiKey = await createApiKey(userId, name || 'Default API Key', expiresInDays);

    res.status(201).json({
      success: true,
      apiKey: {
        id: apiKey.id,
        key: apiKey.key,
        prefix: apiKey.prefix,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt
      },
      message: 'API key created successfully. Store it securely - it will not be shown again.'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request data', details: error.errors });
      return;
    }
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.get('/', async (req, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user.userId;
    const apiKeys = await getUserApiKeys(userId);

    res.json({
      success: true,
      apiKeys
    });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

router.delete('/:id', async (req, res: Response): Promise<void> => {
  try {
    const userId = (req as unknown as AuthenticatedRequest).user.userId;
    const apiKeyId = req.params.id;

    const revoked = await revokeApiKey(userId, apiKeyId);

    if (revoked) {
      res.json({ success: true, message: 'API key revoked successfully' });
    } else {
      res.status(404).json({ error: 'API key not found or already revoked' });
    }
  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
