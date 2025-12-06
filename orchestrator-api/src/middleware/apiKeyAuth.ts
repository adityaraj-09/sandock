import type { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../services/apiKeys.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest } from '../types/index.js';

export function authenticateApiKey() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      logger.debug(`[AUTH] API key authentication for ${req.method} ${req.path}`);

      const apiKey = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);
      const apiKeyPrefix = apiKey ? apiKey.substring(0, 12) + '...' : 'none';

      logger.debug(`[AUTH] API key prefix: ${apiKeyPrefix}`);

      if (!apiKey) {
        logger.warn(`[AUTH] No API key provided for ${req.method} ${req.path}`);
        res.status(401).json({ error: 'API key required' });
        return;
      }

      logger.debug('[AUTH] Validating API key...');
      const keyData = await validateApiKey(apiKey);

      if (!keyData) {
        logger.warn(`[AUTH] Invalid or expired API key (${apiKeyPrefix})`);
        res.status(401).json({ error: 'Invalid or expired API key' });
        return;
      }

      logger.debug(`[AUTH] API key validated successfully for user ${keyData.userId}`);

      (req as AuthenticatedRequest).user = {
        userId: keyData.userId,
        apiKeyId: keyData.apiKeyId,
        email: keyData.email
      };

      logger.debug('[AUTH] Authentication successful, proceeding to route handler');
      next();
    } catch (error) {
      logger.error('[AUTH] API key authentication error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}
